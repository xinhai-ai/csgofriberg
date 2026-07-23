import i18n from '../i18n';

export const PLAYER_ROLE_OPTIONS = [
  { value: 'Rifler', labelKey: 'player.roles.rifler' },
  { value: 'AWPer', labelKey: 'player.roles.awper' },
  { value: 'Coach', labelKey: 'player.roles.coach' },
] as const;

const ROLE_LABELS = new Map<string, string>(
  PLAYER_ROLE_OPTIONS.map(({ value, labelKey }) => [value, labelKey])
);

export function playerRoleLabel(role: string): string {
  const key = ROLE_LABELS.get(role);
  return key ? i18n.t(key) : role;
}
