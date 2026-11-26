import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createServer, type Server } from 'net';
import { replaceFile } from './atomic-file';
import {
  defaultAutomationPolicy,
  type AutomationPolicy,
  type ProductionDay,
} from './automation.types';

const schemas = {
  days: 'production-day/1',
  infrastructure: 'automation-infrastructure/1',
  reviews: 'automation-review/1',
  videos: 'automation-video/1',
  outbox: 'automation-outbox/1',
  commands: 'automation-discord-command/1',
} as const;
type Bucket = keyof typeof schemas;
const keyPattern = /^[a-zA-Z0-9-]{1,100}$/;
export const automationKey = (...parts: unknown[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export async function claimAutomationEndpoint(key: string, conflict: string) {
  const server = createServer((socket) => socket.destroy());
  const endpoint =
    process.platform === 'win32'
      ? { path: '\\\\.\\pipe\\tiktok-automation-' + key }
      : {
          host: '127.0.0.1',
          port: 49152 + (parseInt(key.slice(0, 6), 16) % 16384),
        };
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => {
      server.removeListener('error', reject);
      resolve();
    });
  }).catch(() => {
    throw Error(conflict);
  });
  server.unref();
  return server;
}

@Injectable()
export class AutomationStore {
  readonly root = path.join(
    process.env.STUDIO_DATA_ROOT || path.resolve('.studio-data'),
    'automation',
  );
  private tail: Promise<unknown> = Promise.resolve();
  private owner?: Server;

  serialize<T>(fn: () => Promise<T>) {
    const task = this.tail.then(fn);
    this.tail = task.catch(() => undefined);
    return task;
  }

  // Local OS ownership is released on crash. No stale PID file grants write access.
  async claim() {
    if (this.owner) return;
    await fs.mkdir(this.root, { recursive: true });
    const key = automationKey((await fs.realpath(this.root)).toLowerCase());
    const server = await claimAutomationEndpoint(
      key,
      'AUTOMATION_RUNTIME_ALREADY_OWNED',
    );
    this.owner = server;
  }
  async release() {
    const owner = this.owner;
    if (!owner) return;
    this.owner = undefined;
    await new Promise<void>((resolve) => owner.close(() => resolve()));
  }

  private file(bucket: Bucket, key: string) {
    if (!keyPattern.test(key)) throw Error('INVALID_AUTOMATION_ID');
    return path.join(this.root, bucket, key + '.json');
  }
  private async read<T>(
    file: string,
    schema: string,
    missing?: () => T,
  ): Promise<T | null> {
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return missing?.() ?? null;
      throw error;
    }
    try {
      const value = JSON.parse(raw);
      if (value?.schemaVersion !== schema) throw Error();
      return value;
    } catch {
      throw Error('AUTOMATION_CORRUPT_STATE');
    }
  }
  private async write(file: string, value: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.' + randomUUID() + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), { flag: 'wx' });
    await replaceFile(tmp, file);
  }
  policy() {
    return this.read<AutomationPolicy>(
      path.join(this.root, 'policy.json'),
      'automation-policy/1',
      defaultAutomationPolicy,
    );
  }
  savePolicy(policy: AutomationPolicy) {
    return this.write(path.join(this.root, 'policy.json'), policy);
  }
  async get<T>(bucket: Bucket, key: string) {
    const value = await this.read<T>(this.file(bucket, key), schemas[bucket]);
    if (
      value &&
      (bucket === 'days'
        ? (value as ProductionDay).dayKey
        : (value as { id?: string }).id) !== key
    )
      throw Error('AUTOMATION_CORRUPT_STATE');
    if (value) {
      if (bucket === 'infrastructure') {
        const state = value as any;
        if (
          ![
            'COOLDOWN',
            'PROBING',
            'RETRY_ADMITTED',
            'BLOCKED',
            'CLEARED',
          ].includes(state.status) ||
          !Number.isSafeInteger(state.consecutiveFailures) ||
          state.consecutiveFailures < 1 ||
          ![0, 1].includes(state.recoveryAttempts) ||
          !Number.isFinite(Date.parse(state.lastFailureAt)) ||
          (state.status === 'COOLDOWN' &&
            !Number.isFinite(Date.parse(state.nextProbeAt))) ||
          !/^[a-f0-9]{64}$/.test(state.diagnosticReference)
        )
          throw Error('AUTOMATION_CORRUPT_STATE');
      }

      const row = value as any;
      if (
        bucket === 'days' &&
        (!Array.isArray(row.reservations) ||
          new Set(row.reservations.map((x) => x?.id)).size !==
            row.reservations.length ||
          row.reservations.some(
            (x) =>
              !x ||
              typeof x.id !== 'string' ||
              !['NEW_VIDEO', 'RERENDER'].includes(x.kind) ||
              ![
                'RESERVED',
                'RUNNING',
                'WAITING_HUMAN',
                'COMPLETED',
                'FAILED',
                'CANCELLED',
              ].includes(x.status) ||
              (x.aiLedgerIds && !Array.isArray(x.aiLedgerIds)),
          ))
      )
        throw Error('AUTOMATION_CORRUPT_STATE');
      if (
        bucket === 'videos' &&
        (!Array.isArray(row.versions) ||
          !row.versions.some((v) => v?.version === row.currentVersion) ||
          !['PENDING', 'APPROVED', 'REJECTED'].includes(row.reviewStatus))
      )
        throw Error('AUTOMATION_CORRUPT_STATE');
      if (
        bucket === 'reviews' &&
        (!Array.isArray(row.options) ||
          !Number.isSafeInteger(row.revision) ||
          !['OPEN', 'RESOLVED', 'EXPIRED', 'CANCELLED'].includes(row.status))
      )
        throw Error('AUTOMATION_CORRUPT_STATE');
    }
    return value;
  }
  put<T extends { schemaVersion: string }>(
    bucket: Bucket,
    key: string,
    value: T,
  ) {
    if (value.schemaVersion !== schemas[bucket])
      throw Error('AUTOMATION_CORRUPT_STATE');
    return this.write(this.file(bucket, key), value);
  }
  async list<T>(bucket: Bucket) {
    const names = await fs
      .readdir(path.join(this.root, bucket))
      .catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
    const items: T[] = [];
    for (const name of names)
      if (name.endsWith('.json')) {
        const row = await this.get<T>(bucket, name.slice(0, -5));
        if (!row) throw Error('AUTOMATION_CORRUPT_STATE');
        items.push(row);
      }
    return items;
  }
  async day(key: string, now: string) {
    return (
      (await this.get<ProductionDay>('days', key)) ??
      ({
        schemaVersion: 'production-day/1',
        dayKey: key,
        reservations: [],
        updatedAt: now,
      } as ProductionDay)
    );
  }
}
