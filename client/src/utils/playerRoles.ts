export const PLAYER_ROLE_OPTIONS = [
  { value: 'Rifler', label: '步枪手' },
  { value: 'AWPer', label: '狙击手' },
  { value: 'Coach', label: '教练' },
] as const;

const ROLE_LABELS = new Map<string, string>(
  PLAYER_ROLE_OPTIONS.map(({ value, label }) => [value, label])
);

export function playerRoleLabel(role: string): string {
  return ROLE_LABELS.get(role) ?? role;
}
