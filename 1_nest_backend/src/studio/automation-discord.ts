import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client, GatewayIntentBits, Partials, type Message } from 'discord.js';
import type { Server } from 'net';
import { AutomationService } from './automation.service';
import {
  AutomationStore,
  automationKey,
  claimAutomationEndpoint,
} from './automation.store';
import type { AutomationOutbox } from './automation.types';

export function authorizedAutomationMessage(
  message: {
    author: { id: string; bot?: boolean };
    guildId: string | null;
    channelId: string;
  },
  policy: { user: string; guild: string; channel: string },
) {
  return (
    !message.author.bot &&
    message.author.id === policy.user &&
    message.guildId === policy.guild &&
    message.channelId === policy.channel
  );
}
export function automationCommand(value: string) {
  const [name, ...args] = value.trim().split(/\s+/);
  const lengths: Record<string, [number, number]> = {
    '!auto': [1, 1],
    '!limit': [1, 1],
    '!status': [0, 0],
    '!danhsach': [0, 0],
    '!xem': [1, 1],
    '!chonbai': [2, 2],
    '!chonbl': [2, 13],
    '!xoabl': [2, 2],
    '!giu': [1, 1],
    '!bo': [1, 1],
    '!taive': [1, 1],
    '!baocao': [0, 0],
  };
  if (
    !Object.prototype.hasOwnProperty.call(lengths, name) ||
    args.length < lengths[name][0] ||
    args.length > lengths[name][1]
  )
    return null;
  if (args.some((arg) => !/^[a-zA-Z0-9,-]{1,100}$/.test(arg))) return null;
  return { name, args };
}

@Injectable()
export class AutomationDiscordAdapter implements OnModuleInit, OnModuleDestroy {
  private client?: Client;
  private lease?: Server;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private policy: { user: string; guild: string; channel: string };
  constructor(
    readonly automation: AutomationService,
    readonly store: AutomationStore,
  ) {}
  async onModuleInit() {
    const env = process.env,
      token = env.DISCORD_BOT_TOKEN?.trim();
    if (
      env.STUDIO_OPERATOR_ONLY === '1' ||
      env.STUDIO_AUTOMATION_ENABLED !== '1' ||
      env.STUDIO_AUTOMATION_DISCORD_ENABLED !== '1' ||
      (env.STUDIO_AUTOMATION_TOKEN?.length ?? 0) < 32 ||
      !token
    )
      return;
    const policy = {
      user: env.STUDIO_AUTOMATION_DISCORD_USER_ID,
      guild: env.STUDIO_AUTOMATION_DISCORD_GUILD_ID,
      channel: env.STUDIO_AUTOMATION_DISCORD_CHANNEL_ID,
    };
    if (Object.values(policy).some((x) => !/^\d{16,22}$/.test(x ?? ''))) return;
    this.policy = policy;
    try {
      this.lease = await claimAutomationEndpoint(
        automationKey('discord', token),
        'DISCORD_CLIENT_ALREADY_OWNED',
      );
    } catch {
      return;
    }
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
    this.client.on('error', () => undefined);
    this.client.on(
      'messageCreate',
      (message) => void this.message(message).catch(() => undefined),
    );
    void this.client
      .login(token)
      .then(() => this.schedule())
      .catch(() => this.onModuleDestroy());
  }
  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.client?.destroy();
    this.lease?.close();
  }
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(
      () =>
        void this.flush()
          .catch(() => undefined)
          .finally(() => this.schedule()),
      15000,
    );
    this.timer.unref();
  }
  private async flush() {
    if (!this.client?.isReady()) return;
    const events = (await this.store.list<AutomationOutbox>('outbox')).filter(
      (e) => !e.sentAt && e.attempts < 5 && Date.parse(e.nextAt) <= Date.now(),
    );
    if (!events.length) return;
    const channel = await this.client.channels.fetch(this.policy.channel);
    if (
      !channel?.isSendable() ||
      !('guildId' in channel) ||
      channel.guildId !== this.policy.guild
    )
      return;
    for (const event of events.slice(0, 5)) {
      event.attempts++;
      event.nextAt = new Date(
        Date.now() + Math.min(3600000, 15000 * 2 ** event.attempts),
      ).toISOString();
      await this.store.serialize(() =>
        this.store.put('outbox', event.id, event),
      );
      try {
        await channel.send({
          content: event.text,
          allowedMentions: { parse: [] },
          nonce: event.id.slice(0, 24),
          enforceNonce: true,
        });
        event.sentAt = new Date().toISOString();
        await this.store.serialize(() =>
          this.store.put('outbox', event.id, event),
        );
      } catch {}
    }
  }

  async message(message: Message) {
    if (!this.policy || !authorizedAutomationMessage(message, this.policy))
      return;
    const cmd = automationCommand(message.content);
    if (!cmd) return;
    const requestId = message.id,
      key = automationKey('discord-command', requestId);
    const fresh = await this.store.serialize(async () => {
      if (await this.store.get('commands', key)) return false;
      await this.store.put('commands', key, {
        schemaVersion: 'automation-discord-command/1',
        id: key,
        createdAt: new Date().toISOString(),
      });
      return true;
    });
    if (!fresh) return;
    let artifactPath: string | undefined;
    const reply = (content: string) =>
      message.reply({
        content: content.slice(0, 1900),
        allowedMentions: { parse: [], repliedUser: false },
      });
    try {
      const [id, arg] = cmd.args;
      if (cmd.name === '!status' || cmd.name === '!baocao') {
        const s = await this.automation.status();
        await reply(
          JSON.stringify({
            mode: s.policy.mode,
            day: s.window.dayKey,
            active: s.active,
            usage: s.usage,
            blocker: s.blocker,
          }),
        );
      } else if (cmd.name === '!auto' || cmd.name === '!limit') {
        const p = await this.automation.policy();
        if (cmd.name === '!auto' && !['on', 'off'].includes(id))
          throw Error('INVALID_COMMAND');
        if (cmd.name === '!limit' && !/^(?:[1-9]|10)$/.test(id))
          throw Error('INVALID_COMMAND');
        const next = await this.automation.configure(
          {
            requestId,
            revision: p.revision,
            ...(cmd.name === '!limit'
              ? { policy: { dailyVideoLimit: Number(id) } }
              : {}),
          },
          cmd.name === '!limit' ? 'PATCH' : id === 'on' ? 'START' : 'STOP',
        );
        await reply(next.mode + ' · daily limit ' + next.dailyVideoLimit);
      } else if (cmd.name === '!danhsach') {
        const videos = (await this.automation.videos())
          .filter((x) => x.reviewStatus !== 'REJECTED')
          .slice(0, 15);
        const reviews = (await this.automation.reviews())
          .filter((x) => x.status === 'OPEN')
          .slice(0, 10);
        await reply(
          [
            ...videos.map(
              (v) => v.shortId + ' v' + v.currentVersion + ' ' + v.reviewStatus,
            ),
            ...reviews.map(
              (r) =>
                'Review ' +
                r.shortId +
                ' ' +
                r.type +
                ' · ' +
                r.options
                  .map((x) => x.number + '. ' + x.preview.slice(0, 42))
                  .join(' '),
            ),
          ].join('\n') || 'No videos or reviews',
        );
      } else if (cmd.name === '!chonbai' || cmd.name === '!chonbl') {
        const r = await this.automation.review.review(id);
        if (
          (cmd.name === '!chonbai' && r.type !== 'SELECT_ROOT') ||
          (cmd.name === '!chonbl' && r.type !== 'SELECT_REPLIES')
        )
          throw Error('INVALID_REVIEW_OPTIONS');
        const numbers = cmd.args
          .slice(1)
          .flatMap((x) => x.split(','))
          .map(Number);
        await this.automation.resolve(id, {
          requestId,
          revision: r.revision,
          decision: 'SELECT',
          numbers,
        });
        await reply('Review resolved ' + r.shortId);
      } else {
        const v = await this.automation.review.video(id),
          version = v.versions.find((x) => x.version === v.currentVersion);
        if (cmd.name === '!xem') {
          const entries = version.selectedSourceIds.filter(
            (x) => x !== v.rootSourceId,
          );
          const s = await this.automation.studio.load(v.sessionId);
          await reply(
            'VIDEO ' +
              v.shortId +
              ' v' +
              version.version +
              '\n' +
              entries
                .map(
                  (x, i) =>
                    i +
                    1 +
                    '. ' +
                    (
                      s.items.find(
                        (y) => (y.sourceId ?? y.sourceReference.entityId) === x,
                      )?.displayText ?? x
                    ).slice(0, 120),
                )
                .join('\n'),
          );
        } else if (cmd.name === '!taive') {
          artifactPath =
            'http://127.0.0.1:' +
            (process.env.PORT || '3000') +
            '/api/studio/automation/videos/' +
            v.id +
            '/versions/' +
            version.version +
            '/artifact';
          const manifest = await this.automation.studio.renders.load(
              v.sessionId,
              version.renderJobId,
            ),
            limit = Number(
              process.env.STUDIO_AUTOMATION_DISCORD_ATTACHMENT_BYTES ||
                8 * 1024 * 1024,
            );
          if (
            !Number.isFinite(limit) ||
            !manifest.bytes ||
            manifest.bytes > limit
          )
            throw Error('ATTACHMENT_LIMIT');
          const file = await this.automation.artifact(v.id, version.version);
          try {
            await message.reply({
              files: [{ attachment: file.getStream(), name: 'draft.mp4' }],
              allowedMentions: { parse: [], repliedUser: false },
            });
          } catch {
            throw Error('ATTACHMENT_LIMIT');
          }
        } else {
          const snapshot = await message.fetchReference().catch(() => null);
          if (
            snapshot?.author.id !== this.client?.user?.id ||
            snapshot?.content.split('\n')[0] !==
              'VIDEO ' + v.shortId + ' v' + version.version
          )
            throw Error('STALE_REVIEW');
          if (cmd.name === '!xoabl') {
            const ids = version.selectedSourceIds.filter(
              (x) => x !== v.rootSourceId,
            );
            const source = ids[Number(arg) - 1];
            if (!/^[1-9]\d*$/.test(arg) || !source)
              throw Error('INVALID_REVIEW_OPTIONS');
            await this.automation.revise(v.id, {
              requestId,
              version: version.version,
              sourceId: source,
            });
            await reply('Revision reserved ' + v.shortId);
          } else {
            await this.automation.decide(
              v.id,
              { requestId, version: version.version },
              cmd.name === '!giu' ? 'APPROVED' : 'REJECTED',
            );
            await reply('Saved review ' + v.shortId + ' v' + version.version);
          }
        }
      }
    } catch (error) {
      const code =
        (error as Error).message.match(/^[A-Z][A-Z0-9_]+$/)?.[0] ??
        'AUTOMATION_COMMAND_BLOCKED';
      await reply(
        code === 'ATTACHMENT_LIMIT'
          ? 'Attachment unavailable at this size. Authorized local artifact: ' +
              artifactPath
          : code,
      );
    }
  }
}
