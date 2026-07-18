/** API/Socket 错误码 → 用户可读文案。后端只返回 code,文案统一在此维护 */
const MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: '输入格式不正确',
  INTERNAL_ERROR: '服务器开小差了,请稍后再试',
  AUTH_REQUIRED: '请先登录',
  FORBIDDEN: '没有权限执行此操作',
  USERNAME_TAKEN: '用户名已被注册',
  INVALID_CREDENTIALS: '用户名或密码错误',
  NOT_FOUND: '内容不存在',
  GUEST_KEY_REQUIRED: '访客标识缺失,请刷新页面重试',
  GAME_NOT_FOUND: '对局不存在',
  GAME_FINISHED: '对局已结束',
  ALREADY_GUESSED: '已经猜过这名选手了',
  PLAYER_NOT_FOUND: '选手不存在',
  NICKNAME_TAKEN: '选手昵称已存在',
  EMPTY_PLAYER_POOL: '选手库为空,请联系管理员导入数据',
  // Socket
  IDENTITY_REQUIRED: '身份校验失败,请刷新页面',
  ALREADY_IN_ROOM: '你已在一个房间中,请先退出',
  ROOM_NOT_FOUND: '房间不存在',
  ROOM_STARTED: '对局已开始,无法加入',
  ROOM_FULL: '房间已满',
  NOT_IN_WAITING_ROOM: '当前不在等待中的房间',
  NOT_IN_ROOM: '你不在任何房间中',
  ROOM_NOT_READY: '房间当前不可开始',
  NOT_HOST: '只有房主可以开始对局',
  NEED_TWO_PLAYERS: '需要两名玩家才能开始',
  PLAYERS_NOT_READY: '有玩家尚未准备',
  NO_ACTIVE_ROUND: '当前没有进行中的小局',
  GUESS_LIMIT_REACHED: '本局猜测次数已用完',
  NETWORK_ERROR: '网络异常,请检查连接',
};

export function translate(code: string | undefined | null): string {
  if (!code) return MESSAGES.INTERNAL_ERROR;
  return MESSAGES[code] ?? `未知错误(${code})`;
}
