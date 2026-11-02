import { randomUUID } from 'crypto';
import { ThreadsStore } from './local-store';
import { ThreadsApiError } from './provider';
export type OAuthStage =
  | 'STATE_VALIDATION'
  | 'SHORT_TOKEN_EXCHANGE'
  | 'SHORT_TOKEN_VALIDATION'
  | 'CHECKPOINT_STORAGE'
  | 'LONG_TOKEN_EXCHANGE'
  | 'LONG_TOKEN_VALIDATION'
  | 'TOKEN_STORAGE'
  | 'TOKEN_VERIFICATION';
export class OAuthValidationError extends Error {
  constructor(
    readonly reason:
      | 'ENV_TOKEN_CHANGED'
      | 'STATE_OR_COOKIE_MISSING'
      | 'STATE_NOT_FOUND_OR_REPLAYED'
      | 'STATE_EXPIRED'
      | 'APP_OR_CALLBACK_CHANGED'
      | 'COOKIE_BINDING_MISMATCH'
      | 'CODE_MISSING_OR_INVALID'
      | 'SHORT_TOKEN_MISSING'
      | 'USER_ID_TYPE_INVALID'
      | 'LONG_TOKEN_RESPONSE_INVALID',
  ) {
    super(reason);
  }
}
export class OAuthFailure extends Error {
  constructor(
    readonly diagnostic: {
      runId: string;
      stage: OAuthStage;
      errorCode: string;
      httpStatus: number | null;
      apiCode: number | null;
      apiSubcode: number | null;
      detail: string;
    },
  ) {
    super(
      'BLOCKED_AUTH: ' +
        diagnostic.errorCode +
        '; diagnostic ID ' +
        diagnostic.runId,
    );
  }
}
export class OAuthDiagnostics {
  readonly runId = randomUUID();
  private events: any[] = [];
  constructor(private store: ThreadsStore) {}
  async step<T>(stage: OAuthStage, action: () => Promise<T>): Promise<T> {
    const started = Date.now();
    this.events.push({
      stage,
      status: 'RUNNING',
      at: new Date(started).toISOString(),
    });
    await this.save();
    try {
      const result = await action();
      this.events.push({
        stage,
        status: 'SUCCEEDED',
        elapsedMs: Date.now() - started,
        ...(['SHORT_TOKEN_EXCHANGE', 'LONG_TOKEN_EXCHANGE'].includes(stage)
          ? {
              responseShape: {
                hasAccessToken:
                  typeof (result as any)?.access_token === 'string',
                userIdType:
                  (result as any)?.user_id === null
                    ? 'null'
                    : typeof (result as any)?.user_id,
                expiresInType: typeof (result as any)?.expires_in,
              },
            }
          : {}),
      });
      await this.save();
      return result;
    } catch (e) {
      const api = e instanceof ThreadsApiError ? e : null;
      const diagnostic = {
        runId: this.runId,
        stage,
        errorCode: 'OAUTH_' + stage + '_FAILED',
        httpStatus: api?.httpStatus ?? null,
        apiCode: api?.apiCode ?? null,
        apiSubcode: api?.apiSubcode ?? null,
        detail:
          e instanceof OAuthValidationError
            ? e.reason
            : api?.detail || 'LOCAL_VALIDATION_OR_STORAGE_ERROR',
      };
      this.events.push({
        ...diagnostic,
        status: 'FAILED',
        elapsedMs: Date.now() - started,
      });
      await this.save();
      throw new OAuthFailure(diagnostic);
    }
  }
  private async save() {
    const snapshot = {
      runId: this.runId,
      kind: 'OAUTH_ATTEMPT',
      checkedAt: new Date().toISOString(),
      events: this.events,
    };
    await this.store.write('audit/' + this.runId + '.json', snapshot);
    await this.store.write('auth/last-attempt.json', snapshot);
  }
}
