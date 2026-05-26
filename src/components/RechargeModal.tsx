import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CreditCard,
  ExternalLink,
  Gem,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  WalletCards,
  X,
} from 'lucide-react';
import { useThemeStore } from '../stores/theme';
import { logBus } from '../stores/logs';
import {
  bindRechargeUser,
  checkRechargeOrder,
  createRechargeOrder,
  getRechargeBinding,
  getRechargeConfig,
  getRechargeOrders,
  getRechargePlans,
  retryRechargeOrder,
  unbindRechargeUser,
  type RechargeBinding,
  type RechargeConfig,
  type RechargeOrder,
  type RechargeOrderCheckResponse,
  type RechargeOrderCreateResponse,
  type RechargeOrderStatus,
  type RechargePlan,
} from '../services/api';

interface RechargeModalProps {
  open: boolean;
  onClose: () => void;
}

type PayType = 'alipay' | 'wxpay';
type ResultState =
  | { kind: 'created'; data: RechargeOrderCreateResponse }
  | { kind: 'checked'; data: RechargeOrderCheckResponse };
type T8Window = Window & {
  t8pc?: {
    openExternal?: (url: string) => Promise<{ success: boolean; message?: string }>;
  };
};

const STATUS_LABEL: Record<RechargeOrderStatus, string> = {
  pending: '待付款',
  transferring: '转账中',
  success: '成功',
  transfer_failed: '转账失败',
};
const QUOTA_PER_POWER = 500000;

export default function RechargeModal({ open, onClose }: RechargeModalProps) {
  const { theme, style } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';

  const [loading, setLoading] = useState(false);
  const [configInfo, setConfigInfo] = useState<RechargeConfig | null>(null);
  const [binding, setBinding] = useState<RechargeBinding>({ bound: false });
  const [plans, setPlans] = useState<RechargePlan[]>([]);
  const [orders, setOrders] = useState<RechargeOrder[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [payType, setPayType] = useState<PayType>('alipay');
  const [userIdInput, setUserIdInput] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<ResultState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pollRef = useRef<number | null>(null);
  const payUrlCacheRef = useRef<Record<string, string>>({});

  const rememberPayUrl = useCallback((orderId?: string, payUrl?: string) => {
    const id = String(orderId || '').trim();
    const url = String(payUrl || '').trim();
    if (id && /^https?:\/\//i.test(url)) payUrlCacheRef.current[id] = url;
  }, []);

  const rememberOrderPayUrls = useCallback((list: RechargeOrder[]) => {
    for (const order of list) rememberPayUrl(order.order_id, order.pay_url);
  }, [rememberPayUrl]);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedId) || null,
    [plans, selectedId],
  );

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshOrders = useCallback(async () => {
    const list = await getRechargeOrders(20);
    rememberOrderPayUrls(list);
    setOrders(list);
  }, [rememberOrderPayUrls]);

  const refreshBinding = useCallback(async () => {
    const b = await getRechargeBinding();
    setBinding(b);
    if (b.bound && b.website_user_id) setUserIdInput(String(b.website_user_id));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setNotice('');
    try {
      const [cfg, b, ps, os] = await Promise.all([
        getRechargeConfig(),
        getRechargeBinding(),
        getRechargePlans(),
        getRechargeOrders(20),
      ]);
      setConfigInfo(cfg);
      setBinding(b);
      setPlans(ps);
      rememberOrderPayUrls(os);
      setOrders(os);
      if (b.bound && b.website_user_id) setUserIdInput(String(b.website_user_id));
      if (ps.length > 0) setSelectedId((cur) => cur || ps[0].id);
    } catch (e: any) {
      setNotice(e?.message || '充值信息加载失败');
    } finally {
      setLoading(false);
    }
  }, [rememberOrderPayUrls]);

  useEffect(() => {
    if (!open) {
      setConfirmOpen(false);
      clearPoll();
      return;
    }
    void loadAll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirmOpen) {
        setConfirmOpen(false);
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearPoll();
      window.removeEventListener('keydown', onKey);
    };
  }, [open, loadAll, clearPoll, onClose, confirmOpen]);

  const panelCls = isPixel
    ? 'px-card'
    : `rounded-xl border shadow-2xl ${isDark ? 'bg-zinc-900 border-white/10 text-white' : 'bg-white border-black/10 text-zinc-900'}`;
  const sectionCls = isPixel
    ? 'rounded-[14px] border-2 border-[var(--px-ink)] bg-[var(--px-surface)] p-3'
    : `rounded-xl border p-3 ${isDark ? 'bg-white/[0.03] border-white/10' : 'bg-zinc-50 border-black/10'}`;
  const inputCls = isPixel
    ? 'px-input w-full px-3 py-2 text-sm'
    : `w-full px-3 py-2 rounded-lg border text-sm outline-none ${
        isDark
          ? 'bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-amber-400/60'
          : 'bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:border-amber-400'
      }`;
  const primaryBtnCls = isPixel
    ? 'px-btn px-btn--yellow justify-center disabled:opacity-50'
    : 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed';
  const ghostBtnCls = isPixel
    ? 'px-btn px-btn--ghost justify-center disabled:opacity-50'
    : `inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${
        isDark ? 'border-white/10 bg-white/5 text-white/75 hover:bg-white/10' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
      }`;
  const hintCls = isPixel ? 'text-[var(--px-ink-soft)]' : isDark ? 'text-white/50' : 'text-zinc-500';
  const titleCls = isPixel ? 'px-title text-[var(--px-ink)]' : isDark ? 'text-white' : 'text-zinc-900';

  const bindUser = async () => {
    const uid = userIdInput.trim();
    if (!/^\d+$/.test(uid)) {
      setNotice('用户 ID 必须是纯数字');
      return;
    }
    setBusy('bind');
    setNotice('');
    try {
      await bindRechargeUser(Number(uid));
      await refreshBinding();
      logBus.success(`充值账号已绑定: ${uid}`, 'recharge');
    } catch (e: any) {
      setNotice(e?.message || '绑定失败');
    } finally {
      setBusy('');
    }
  };

  const unbindUser = async () => {
    if (!window.confirm('确认解除当前绑定的账号吗？')) return;
    setBusy('unbind');
    setNotice('');
    try {
      await unbindRechargeUser();
      setBinding({ bound: false });
      logBus.warn('充值账号已解绑', 'recharge');
    } catch (e: any) {
      setNotice(e?.message || '解绑失败');
    } finally {
      setBusy('');
    }
  };

  const applyCheckedResult = useCallback(async (data: RechargeOrderCheckResponse, fromPoll: boolean) => {
    const cachedPayUrl = data.pay_url || payUrlCacheRef.current[data.order_id] || '';
    if (cachedPayUrl) rememberPayUrl(data.order_id, cachedPayUrl);
    setResult({
      kind: 'checked',
      data: cachedPayUrl ? { ...data, pay_url: cachedPayUrl } : data,
    });
    if (data.status === 'success') {
      clearPoll();
      logBus.success(`充值订单完成: ${data.order_id}`, 'recharge');
      await refreshOrders();
    } else if (data.status === 'transfer_failed') {
      clearPoll();
      logBus.error(`充值订单转账失败: ${data.order_id}`, 'recharge');
      await refreshOrders();
    } else if (data.status === 'transferring') {
      if (!fromPoll) logBus.info(`订单转账处理中: ${data.order_id}`, 'recharge');
    } else if (!fromPoll) {
      logBus.warn(`订单尚未付款: ${data.order_id}`, 'recharge');
    }
  }, [clearPoll, refreshOrders, rememberPayUrl]);

  const pollOnce = useCallback(async (orderId: string, fromPoll = false) => {
    try {
      const data = await checkRechargeOrder(orderId);
      await applyCheckedResult(data, fromPoll);
    } catch (e: any) {
      if (!fromPoll) setNotice(e?.message || '查询订单失败');
    }
  }, [applyCheckedResult]);

  const startPoll = useCallback((orderId: string) => {
    clearPoll();
    pollRef.current = window.setInterval(() => {
      void pollOnce(orderId, true);
    }, 3000);
  }, [clearPoll, pollOnce]);

  const openPayUrl = useCallback(async (payUrl?: string) => {
    const url = String(payUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      setNotice('付款链接无效，请重新创建订单');
      return false;
    }
    try {
      const bridge = (window as T8Window).t8pc;
      if (bridge?.openExternal) {
        const r = await bridge.openExternal(url);
        if (r?.success) return true;
        throw new Error(r?.message || '打开付款页失败');
      }
    } catch (e: any) {
      console.warn('[recharge] electron openExternal failed:', e?.message || e);
    }
    const popup = window.open(url, '_blank', 'noopener,noreferrer');
    if (popup) return true;
    setNotice('付款窗口被系统拦截，请点击“复制付款链接”后粘贴到浏览器打开');
    return false;
  }, []);

  const copyPayUrl = useCallback(async (payUrl?: string) => {
    const url = String(payUrl || '').trim();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      logBus.info('付款链接已复制', 'recharge');
    } catch {
      setNotice(`复制失败，请手动复制付款链接：${url}`);
    }
  }, []);

  const requestCreateOrder = () => {
    if (!binding.bound) {
      setNotice('请先绑定网站用户 ID');
      return;
    }
    if (!selectedPlan) {
      setNotice('请先选择充值套餐');
      return;
    }
    setNotice('');
    setConfirmOpen(true);
  };

  const createOrder = async () => {
    if (!binding.bound || !selectedPlan) {
      setConfirmOpen(false);
      setNotice('请先确认绑定账号和充值套餐');
      return;
    }
    setConfirmOpen(false);
    setBusy('create');
    setNotice('');
    try {
      const data = await createRechargeOrder(selectedPlan.id, payType);
      rememberPayUrl(data.order_id, data.pay_url);
      setResult({ kind: 'created', data });
      await refreshOrders();
      startPoll(data.order_id);
      logBus.success(`充值订单已创建: ${data.order_id}`, 'recharge');
      void openPayUrl(data.pay_url);
    } catch (e: any) {
      setNotice(e?.message || '创建订单失败');
      logBus.error(`创建充值订单失败: ${e?.message || e}`, 'recharge');
    } finally {
      setBusy('');
    }
  };

  const retryOrder = async (orderId: string) => {
    if (!window.confirm(`确认重试补发该订单额度吗？\n${orderId}`)) return;
    setBusy(`retry:${orderId}`);
    setNotice('');
    try {
      const data = await retryRechargeOrder(orderId);
      await applyCheckedResult(data, false);
    } catch (e: any) {
      setNotice(e?.message || '补发失败');
    } finally {
      setBusy('');
    }
  };

  if (!open) return null;

  const renderStatus = (status: RechargeOrderStatus) => {
    const cls = isPixel
      ? status === 'success'
        ? 'px-chip px-chip--mint'
        : status === 'transfer_failed'
          ? 'px-chip px-chip--pink'
          : status === 'transferring'
            ? 'px-chip px-chip--yellow'
            : 'px-chip px-chip--muted'
      : `inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          status === 'success'
            ? isDark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-100 text-emerald-700'
            : status === 'transfer_failed'
              ? isDark ? 'bg-red-500/15 text-red-300' : 'bg-red-100 text-red-700'
              : status === 'transferring'
                ? isDark ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-100 text-amber-700'
                : isDark ? 'bg-white/10 text-white/60' : 'bg-zinc-100 text-zinc-600'
        }`;
    return <span className={cls}>{STATUS_LABEL[status] || status}</span>;
  };

  const resultData = result?.data;
  const resultStatus = result?.kind === 'created' ? 'pending' : result?.data.status;
  const resultPayUrl = resultData?.order_id
    ? String(
        resultData.pay_url ||
        payUrlCacheRef.current[resultData.order_id] ||
        orders.find((order) => order.order_id === resultData.order_id)?.pay_url ||
        '',
      )
    : '';

  return (
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center p-4 ${isPixel ? 'px-modal-mask' : 'bg-black/60 backdrop-blur-sm'}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col ${panelCls}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recharge-title"
      >
        <div
          className={`flex items-center gap-3 px-5 py-4 border-b shrink-0 ${
            isPixel ? 'border-[var(--px-ink)] bg-[var(--px-yellow)]' : isDark ? 'border-white/10' : 'border-black/10'
          }`}
        >
          <Gem size={20} className={isPixel ? 'text-[var(--px-ink)]' : 'text-amber-400'} />
          <div className="flex-1 min-w-0">
            <h2 id="recharge-title" className={`text-base font-semibold ${titleCls}`}>算力充值</h2>
            <p className={`text-xs mt-0.5 ${hintCls}`}>绑定网站账号后选择套餐，付款完成会自动轮询并转入额度。</p>
          </div>
          <button
            onClick={onClose}
            className={isPixel ? 'px-btn px-btn--icon px-btn--ghost' : ghostBtnCls}
            title="关闭"
            aria-label="关闭充值弹窗"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {notice && (
            <div className={isPixel ? 'px-row bg-[var(--px-pink)]' : `rounded-lg border px-3 py-2 text-sm ${isDark ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
              <AlertTriangle size={15} className="inline mr-1.5" />
              {notice}
            </div>
          )}

          <div className={sectionCls}>
            <div className="flex flex-wrap items-center gap-2">
              {configInfo?.configured ? (
                <CheckCircle2 size={16} className={isPixel ? 'text-[var(--px-ink)]' : 'text-emerald-400'} />
              ) : (
                <AlertTriangle size={16} className={isPixel ? 'text-[var(--px-ink)]' : 'text-amber-400'} />
              )}
              <span className={`text-sm font-semibold ${titleCls}`}>
                {configInfo?.configured ? '支付服务已就绪' : loading ? '正在加载支付服务' : '支付服务未配置'}
              </span>
              <span className={`text-xs ${hintCls}`}>
                网站 {configInfo?.website_url || 'https://ai.t8star.org'} · 设备 {configInfo?.device_id || '-'}
              </span>
              <button className={`${ghostBtnCls} ml-auto !py-1 !px-2 !text-xs`} onClick={loadAll} disabled={loading}>
                {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                刷新
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <div className={`${sectionCls} space-y-3`}>
              <div className="flex items-center gap-2">
                <Link2 size={16} className={isPixel ? 'text-[var(--px-ink)]' : 'text-cyan-400'} />
                <h3 className={`text-sm font-semibold ${titleCls}`}>绑定网站账号</h3>
                {binding.bound ? (
                  <span className={isPixel ? 'px-chip px-chip--mint ml-auto' : 'ml-auto text-xs text-emerald-400'}>已绑定</span>
                ) : (
                  <span className={isPixel ? 'px-chip px-chip--yellow ml-auto' : 'ml-auto text-xs text-amber-400'}>未绑定</span>
                )}
              </div>
              <input
                value={userIdInput}
                onChange={(e) => setUserIdInput(e.target.value)}
                disabled={binding.bound}
                className={inputCls}
                placeholder="在网站个人中心查看数字 ID"
              />
              <div className="flex gap-2">
                {binding.bound ? (
                  <button className={ghostBtnCls} onClick={unbindUser} disabled={busy === 'unbind'}>
                    {busy === 'unbind' && <Loader2 size={14} className="animate-spin" />}
                    解绑
                  </button>
                ) : (
                  <button className={primaryBtnCls} onClick={bindUser} disabled={busy === 'bind'}>
                    {busy === 'bind' && <Loader2 size={14} className="animate-spin" />}
                    绑定
                  </button>
                )}
              </div>
              <p className={`text-xs leading-relaxed ${hintCls}`}>
                充值额度会转入此网站账号。若绑定错误，请先解绑后重新绑定。
              </p>
            </div>

            <div className={`${sectionCls} space-y-3`}>
              <div className="flex items-center gap-2">
                <WalletCards size={16} className={isPixel ? 'text-[var(--px-ink)]' : 'text-amber-400'} />
                <h3 className={`text-sm font-semibold ${titleCls}`}>选择套餐</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {plans.map((plan) => {
                  const active = plan.id === selectedId;
                  return (
                    <button
                      key={plan.id}
                      onClick={() => setSelectedId(plan.id)}
                      className={
                        isPixel
                          ? `rounded-[12px] border-2 border-[var(--px-ink)] p-3 text-left shadow-[2px_2px_0_var(--px-ink)] ${
                              active ? 'bg-[var(--px-yellow)]' : 'bg-[var(--px-surface)] hover:bg-[var(--px-muted)]'
                            }`
                          : `rounded-xl border p-3 text-left transition ${
                              active
                                ? isDark ? 'border-amber-400 bg-amber-500/15' : 'border-amber-400 bg-amber-50'
                                : isDark ? 'border-white/10 bg-white/5 hover:bg-white/10' : 'border-zinc-200 bg-white hover:bg-zinc-50'
                            }`
                      }
                    >
                      <div className={`text-lg font-black ${isPixel ? 'text-[var(--px-ink)]' : active ? 'text-amber-500' : titleCls}`}>
                        {plan.power} CP
                      </div>
                      <div className={`text-xs ${hintCls}`}>{plan.test ? '测试套餐' : plan.name}</div>
                      <div className={isPixel ? 'mt-1 font-bold text-[var(--px-ink)]' : 'mt-1 font-bold text-emerald-500'}>
                        ￥{plan.price.toFixed(2)}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['alipay', 'wxpay'] as PayType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setPayType(type)}
                    className={
                      isPixel
                        ? `px-btn justify-center ${payType === type ? 'px-btn--mint' : 'px-btn--ghost'}`
                        : `rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                            payType === type
                              ? isDark ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200' : 'border-emerald-400 bg-emerald-50 text-emerald-700'
                              : isDark ? 'border-white/10 bg-white/5 text-white/70' : 'border-zinc-200 bg-white text-zinc-700'
                          }`
                    }
                  >
                    {type === 'alipay' ? '支付宝' : '微信支付'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={`${sectionCls} flex flex-wrap items-center gap-3`}>
            <CreditCard size={16} className={isPixel ? 'text-[var(--px-ink)]' : 'text-emerald-400'} />
            <div className="min-w-0 flex-1 text-sm">
              {selectedPlan && binding.bound ? (
                <span>
                  将为账号 <b>{binding.website_user_id}</b> 创建 <b>{selectedPlan.name}</b> 订单，金额 <b>￥{selectedPlan.price.toFixed(2)}</b>
                </span>
              ) : (
                <span className={hintCls}>完成绑定并选择套餐后即可创建订单。</span>
              )}
            </div>
            <button
              className={primaryBtnCls}
              onClick={requestCreateOrder}
              disabled={busy === 'create' || !binding.bound || !selectedPlan}
            >
              {busy === 'create' ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
              创建订单并付款
            </button>
          </div>

          {resultData && (
            <div className={`${sectionCls} space-y-3`}>
              <div className="flex flex-wrap items-center gap-2">
                {resultStatus === 'success' ? <CheckCircle2 size={16} className="text-emerald-400" /> : <Clock3 size={16} className={isPixel ? 'text-[var(--px-ink)]' : 'text-amber-400'} />}
                <h3 className={`text-sm font-semibold ${titleCls}`}>
                  {resultStatus === 'success' ? '付款成功，额度已转入' : resultStatus === 'transfer_failed' ? '付款成功但转账失败' : resultStatus === 'transferring' ? '付款成功，转账处理中' : '订单已创建，等待付款'}
                </h3>
                {resultStatus && renderStatus(resultStatus)}
              </div>
              <div className={`grid gap-2 text-xs sm:grid-cols-2 ${hintCls}`}>
                <div>订单号：<code className={isPixel ? 'font-bold text-[var(--px-ink)]' : 'font-mono'}>{resultData.order_id}</code></div>
                <div>套餐：{resultData.plan_name}</div>
                <div>金额：￥{Number(resultData.amount).toFixed(2)}</div>
                <div>额度：{(Number(resultData.quota) / QUOTA_PER_POWER).toFixed(2)} CP</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {resultStatus === 'pending' && resultPayUrl && (
                  <>
                    <button
                      type="button"
                      onClick={() => void openPayUrl(resultPayUrl)}
                      className={primaryBtnCls}
                    >
                      <ExternalLink size={14} />
                      打开付款页
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyPayUrl(resultPayUrl)}
                      className={ghostBtnCls}
                    >
                      <Link2 size={14} />
                      复制付款链接
                    </button>
                  </>
                )}
                {resultStatus === 'pending' && !resultPayUrl && (
                  <div className={`flex items-center gap-1 text-xs ${hintCls}`}>
                    <ExternalLink size={14} />
                    当前订单缺少付款链接，请重新创建订单或刷新后再试。
                  </div>
                )}
                <button className={ghostBtnCls} onClick={() => void pollOnce(resultData.order_id, false)}>
                  <RefreshCw size={14} />
                  主动查询状态
                </button>
                {resultStatus === 'transfer_failed' && (
                  <button className={primaryBtnCls} onClick={() => retryOrder(resultData.order_id)} disabled={busy === `retry:${resultData.order_id}`}>
                    {busy === `retry:${resultData.order_id}` ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    重试补发
                  </button>
                )}
              </div>
            </div>
          )}

          <div className={`${sectionCls} space-y-3`}>
            <div className="flex items-center gap-2">
              <Clock3 size={16} className={isPixel ? 'text-[var(--px-ink)]' : 'text-sky-400'} />
              <h3 className={`text-sm font-semibold ${titleCls}`}>订单历史</h3>
              <button className={`${ghostBtnCls} ml-auto !py-1 !px-2 !text-xs`} onClick={refreshOrders}>
                <RefreshCw size={13} />
                刷新
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-2">
              {orders.length === 0 ? (
                <div className={`text-center text-xs py-6 ${hintCls}`}>暂无订单</div>
              ) : (
                orders.map((order) => (
                  <div key={order.order_id} className={isPixel ? 'px-row gap-2' : `flex items-center gap-2 rounded-lg border px-3 py-2 ${isDark ? 'border-white/10 bg-white/5' : 'border-zinc-200 bg-white'}`}>
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs font-semibold truncate ${titleCls}`}>{order.plan_name || order.plan_id}</div>
                      <div className={`text-[11px] truncate ${hintCls}`}>
                        {order.create_time || '-'} · ￥{Number(order.amount || 0).toFixed(2)} · {order.pay_type}
                      </div>
                    </div>
                    {renderStatus(order.status)}
                    {order.status === 'pending' && order.pay_url && (
                      <button className={`${primaryBtnCls} !py-1 !px-2 !text-xs`} onClick={() => void openPayUrl(order.pay_url)}>
                        付
                      </button>
                    )}
                    <button className={`${ghostBtnCls} !py-1 !px-2 !text-xs`} onClick={() => void pollOnce(order.order_id, false)}>
                      查
                    </button>
                    {order.status === 'transfer_failed' && (
                      <button className={`${primaryBtnCls} !py-1 !px-2 !text-xs`} onClick={() => retryOrder(order.order_id)}>
                        补发
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={`${sectionCls} flex items-start gap-2`}>
            <ShieldCheck size={16} className={isPixel ? 'text-[var(--px-ink)]' : 'text-amber-400'} />
            <div className={`text-xs leading-relaxed ${hintCls}`}>
              <div>整合包支付仅供体验，不开发票。如需开票需要对公支付，1000 以上，付 10% 税点并签署商业合同。</div>
              <div className="mt-1">本站为海外独立站，用户遍布全球。请根据您当地法律法规合规使用，整合包和平台不承担任何法律责任。</div>
            </div>
          </div>
        </div>
      </div>

      {confirmOpen && selectedPlan && binding.bound && (
        <div
          className={`absolute inset-0 z-[90] flex items-center justify-center p-4 ${isPixel ? 'bg-[rgba(26,20,16,0.38)]' : 'bg-black/70 backdrop-blur-sm'}`}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmOpen(false);
          }}
        >
          <div
            className={`w-full max-w-md overflow-hidden ${isPixel
              ? 'px-card'
              : `rounded-2xl border shadow-2xl ${isDark ? 'border-red-400/30 bg-zinc-950 text-white' : 'border-red-200 bg-white text-zinc-900'}`
            }`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="recharge-confirm-title"
            aria-describedby="recharge-confirm-desc"
          >
            <div className={isPixel ? 'border-b-2 border-[var(--px-ink)] bg-[var(--px-pink)] px-5 py-4' : `border-b px-5 py-4 ${isDark ? 'border-red-400/20 bg-red-500/12' : 'border-red-100 bg-red-50'}`}>
              <div className="flex items-center gap-3">
                <div className={isPixel ? 'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-[var(--px-ink)] bg-[var(--px-yellow)] shadow-[2px_2px_0_var(--px-ink)]' : `flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${isDark ? 'bg-red-500/20 text-red-200' : 'bg-red-100 text-red-600'}`}>
                  <AlertTriangle size={26} />
                </div>
                <div className="min-w-0">
                  <h3 id="recharge-confirm-title" className={`text-base font-black ${titleCls}`}>充值前确认</h3>
                  <p id="recharge-confirm-desc" className={`mt-1 text-sm font-bold ${isPixel ? 'text-[var(--px-ink)]' : isDark ? 'text-red-100' : 'text-red-700'}`}>
                    请核对绑定的用户ID，一旦充错无法退回！
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 p-5">
              <div className={isPixel ? 'rounded-[14px] border-2 border-[var(--px-ink)] bg-[var(--px-surface)] p-3 shadow-[2px_2px_0_var(--px-ink)]' : `rounded-xl border p-3 ${isDark ? 'border-white/10 bg-white/[0.04]' : 'border-zinc-200 bg-zinc-50'}`}>
                <div className="grid gap-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className={hintCls}>绑定用户 ID</span>
                    <b className={isPixel ? 'text-[var(--px-ink)]' : 'font-mono'}>{binding.website_user_id}</b>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className={hintCls}>充值套餐</span>
                    <b>{selectedPlan.name}</b>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className={hintCls}>支付金额</span>
                    <b className={isPixel ? 'text-[var(--px-ink)]' : 'text-amber-500'}>￥{selectedPlan.price.toFixed(2)}</b>
                  </div>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button className={ghostBtnCls} onClick={() => setConfirmOpen(false)}>
                  取消
                </button>
                <button className={primaryBtnCls} onClick={createOrder} disabled={busy === 'create'}>
                  {busy === 'create' ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
                  我已核对，继续付款
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
