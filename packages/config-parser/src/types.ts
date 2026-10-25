import type { Profile } from '@v2rb/shared';

export type ParseErrorCode =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_SCHEME'
  | 'MALFORMED'
  | 'INVALID_PORT'
  | 'MISSING_PORT'
  | 'INVALID_HOST'
  | 'INVALID_UUID'
  | 'INVALID_PASSWORD'
  | 'INVALID_METHOD'
  | 'MISSING_FIELD'
  | 'BASE64'
  | 'JSON'
  | 'UNSUPPORTED_PROTOCOL_VERSION'
  | 'NOTHING_FOUND';

export interface ParseIssue {
  code: ParseErrorCode;
  message: string;
  field?: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ParseIssue };

/** A parsed profile before it is assigned an id and timestamps by the store. */
export type ParsedProfile = Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>;

export type {
  Profile,
  ProfileSourceType,
  ConnectKind,
  ProtocolId,
  SecurityType,
  TransportType,
  TransportSettings,
  TlsSettings,
  Credentials,
} from '@v2rb/shared';
