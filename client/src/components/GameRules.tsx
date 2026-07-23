import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Eye,
  Flag,
  MapPinned,
  Target,
  Users,
  X,
} from 'lucide-react';
import ModalPortal from './ModalPortal';

const regions = [
  ['欧洲赛区', '西欧、南欧、巴尔干半岛、科索沃、波罗的海三国与乌克兰'],
  ['独联体赛区', '俄罗斯、白俄罗斯、哈萨克斯坦、阿塞拜疆、乌兹别克斯坦等独联体与中亚国家'],
  ['亚太赛区', '中国、中国香港、中国台湾、东南亚、中东国家（以色列除外）与土耳其'],
  ['大洋洲赛区', '澳大利亚、新西兰'],
  ['北美洲赛区', '美国、加拿大、危地马拉等北美洲与中美洲国家'],
  ['南美洲赛区', '巴西、阿根廷、乌拉圭、智利等南美洲国家'],
  ['非洲和以色列赛区', '南非、以色列'],
] as const;

export default function GameRules() {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const closeRules = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRules();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeRules, open]);

  return (
    <>
      <button
        ref={triggerRef}
        className="game-rules-trigger"
        type="button"
        onClick={() => setOpen(true)}
      >
        <BookOpen size={14} aria-hidden="true" />
        游戏规则
      </button>

      {open && (
        <ModalPortal>
          <div
            className="game-rules-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeRules();
            }}
          >
            <div
              className="game-rules-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <header className="game-rules-dialog-heading">
                <span className="game-rules-heading-icon" aria-hidden="true">
                  <BookOpen size={24} />
                </span>
                <div className="game-rules-heading-copy">
                  <span className="game-rules-kicker">HOW TO PLAY</span>
                  <h2 id={titleId}>游戏规则</h2>
                  <p>根据每次猜测的颜色与箭头反馈，找出系统随机选定的职业选手。</p>
                </div>
                <strong className="guess-limit"><span>最多</span> 8 次猜测</strong>
                <button
                  ref={closeRef}
                  className="confirm-close"
                  type="button"
                  aria-label="关闭游戏规则"
                  onClick={closeRules}
                >
                  <X size={18} />
                </button>
              </header>

              <div className="game-rules-dialog-body">
                <div className="rule-quick-guide" aria-label="反馈颜色说明">
                  <div className="rule-feedback rule-feedback-correct">
                    <span className="rule-color-swatch" aria-hidden="true" />
                    <div><strong>绿色 · 完全正确</strong><span>该项与答案一致</span></div>
                  </div>
                  <div className="rule-feedback rule-feedback-close">
                    <span className="rule-color-swatch" aria-hidden="true" />
                    <div><strong>黄色 · 接近答案</strong><span>赛区相同或数值接近</span></div>
                  </div>
                  <div className="rule-feedback rule-feedback-wrong">
                    <span className="rule-color-swatch" aria-hidden="true" />
                    <div><strong>灰色 · 不匹配</strong><span>该项与答案差距较大</span></div>
                  </div>
                  <div className="rule-feedback rule-feedback-arrow">
                    <span className="rule-arrow-pair" aria-hidden="true"><ArrowUp size={16} /><ArrowDown size={16} /></span>
                    <div><strong>箭头 · 调整方向</strong><span>年龄与 Major 数值更大或更小</span></div>
                  </div>
                </div>

                <div className="rule-sections">
                  <article className="rule-panel rule-panel-main">
                    <div className="rule-panel-title">
                      <span aria-hidden="true"><Target size={20} /></span>
                      <div><small>01</small><h3>猜测与反馈</h3></div>
                    </div>
                    <p>输入选手 ID 后，每次猜测会新增一行结果。不同字段会按以下方式给出提示：</p>
                    <div className="rule-field-grid">
                      <div>
                        <strong>只判断完全正确</strong>
                        <span>昵称、队伍、位置、状态</span>
                      </div>
                      <div>
                        <strong>国家或地区</strong>
                        <span>国家错误但赛区相同显示黄色</span>
                      </div>
                      <div>
                        <strong>年龄</strong>
                        <span>与答案相差 3 岁以内显示黄色</span>
                      </div>
                      <div>
                        <strong>Major 数据</strong>
                        <span>冠军数或参赛数相差 1 次以内显示黄色</span>
                      </div>
                    </div>
                    <div className="rule-result-notes">
                      <p><span className="rule-result-icon rule-result-win"><Flag size={15} /></span><strong>胜利：</strong>昵称猜对即结束游戏。</p>
                      <p><span className="rule-result-icon rule-result-loss">8</span><strong>失败：</strong>8 次仍未猜中，或主动查看答案。</p>
                    </div>
                  </article>

                  <article className="rule-panel rule-panel-multi">
                    <div className="rule-panel-title">
                      <span aria-hidden="true"><Users size={20} /></span>
                      <div><small>02</small><h3>多人模式特殊机制</h3></div>
                    </div>
                    <ul className="rule-list">
                      <li><Eye size={17} aria-hidden="true" /><span>对局中可同时看到自己与对手每次猜测的<strong>对错信息</strong>。</span></li>
                      <li><span className="rule-list-number">5s</span><span>回合结束后的 5 秒结算期内，双方的<strong>全部猜测内容</strong>会互相公开。</span></li>
                      <li><Flag size={17} aria-hidden="true" /><span>点击“本轮投降”会立即结束当前回合，并判定自己<strong>本轮失败</strong>。</span></li>
                    </ul>
                  </article>

                  <article className="rule-panel rule-panel-regions">
                    <div className="rule-panel-title">
                      <span aria-hidden="true"><MapPinned size={20} /></span>
                      <div><small>03</small><h3>国家和地区的赛区划分</h3></div>
                    </div>
                    <p>赛区划分与 blast.tv 规则保持一致。国家或地区猜错，但赛区相同时会显示黄色。</p>
                    <div className="region-list">
                      {regions.map(([name, countries]) => (
                        <div className="region-item" key={name}>
                          <strong>{name}</strong>
                          <span>{countries}</span>
                        </div>
                      ))}
                    </div>
                  </article>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
