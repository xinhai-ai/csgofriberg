import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import Page from '../components/Page';
import { api, errMsg } from '../api/client';
import { useAuth } from '../store/auth';
import { closeSocket, getSocket } from '../api/socket';
import { markAuthenticated } from '../api/session';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setUser = useAuth((s) => s.setUser);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirmPassword) {
      return setError('两次输入的密码不一致');
    }
    setLoading(true);
    try {
      const res = await api.post(`/auth/${mode}`, { username, password });
      markAuthenticated();
      setUser(res.data.user);
      closeSocket();
      getSocket();
      // 把匿名期间的对局并入账号(失败不阻塞登录)
      try {
        await api.post('/auth/claim');
      } catch {
        /* 忽略 */
      }
      navigate('/');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page title={mode === 'login' ? '登录' : '注册'} icon={<KeyRound size={17} />}>
      <div className="card auth-card">
        <p className="muted" style={{ textAlign: 'center' }}>
          登录仅用于跨设备保存战绩与进度,所有模式无需登录即可游玩
        </p>
        <form className="form" onSubmit={submit}>
          <input
            className="input"
            placeholder="用户名"
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="密码(至少 10 位)"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'register' && (
            <input
              className="input"
              type="password"
              placeholder="确认密码"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          )}
          {error && <div className="error">{error}</div>}
          <button className="btn" disabled={loading}>
            {mode === 'login' ? '登录' : '注册'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setError('');
              setConfirmPassword('');
              setMode(mode === 'login' ? 'register' : 'login');
            }}
          >
            {mode === 'login' ? '没有账号?去注册' : '已有账号?去登录'}
          </button>
        </form>
      </div>
    </Page>
  );
}
