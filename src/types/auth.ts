import type { ProviderName } from "./model.js";

export type AuthMethod = "native_login" | "api_key" | "env_variable" | "credential_helper";

export interface ICredential {
  readonly provider: ProviderName;
  readonly method: AuthMethod;
  readonly token?: string | undefined;
  readonly refreshToken?: string | undefined;
  readonly expiresAt?: Date | undefined;
  readonly email?: string | undefined;
  readonly plan?: string | undefined;
}
