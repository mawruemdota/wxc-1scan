'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import Papa from 'papaparse';
import { zipFiles, type ZipEntry } from '@/lib/zip';
import type { PassStatus } from '@/lib/admin-query';

type Pass = {
  id: number;
  pass_key: string;
  status: 'unused' | 'reserved' | 'claimed';
  reserved_until: string | null;
  claimed_full_name: string | null;
  claimed_username: string | null;
  claimed_email: string | null;
  claim_date: string | null;
  claimed_at: string | null;
  created_at: string;
};
type Stats = { total: number; unused: number; reserved: number; claimed: number };
type CleanupPreview = { ok: boolean; total: number; claimed: number; activeReservations: number; receipts: number; maxId: number };
type AdminData = { ok: boolean; passes: Pass[]; count: number; allowedPlayerCount: number; stats: Stats; serverNow: string };
type IconName = 'qr' | 'grid' | 'users' | 'shield' | 'search' | 'download' | 'refresh' | 'logout' | 'plus' | 'check' | 'clock' | 'key' | 'copy' | 'upload' | 'file' | 'chevron-left' | 'chevron-right' | 'x' | 'alert' | 'filter' | 'menu';
const PAGE_SIZE = 25;
const EMPTY_STATS: Stats = { total: 0, unused: 0, reserved: 0, claimed: 0 };

function Icon({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    qr: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v3M14 21h3M21 21v-2M19 19h2"/></>,
    grid: <><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 17v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 10a7 7 0 0 1 12-3L20 12M4 12l2.5 5a7 7 0 0 0 12-3"/></>,
    logout: <><path d="M10 17l5-5-5-5m5 5H3"/><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    key: <><circle cx="8" cy="15" r="5"/><path d="m12 11 8-8m-3 0h3v3m-5 0h3v3"/></>,
    copy: <><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 16v4h16v-4"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
    'chevron-left': <path d="m15 18-6-6 6-6"/>,
    'chevron-right': <path d="m9 18 6-6-6-6"/>,
    x: <path d="M18 6 6 18M6 6l12 12"/>,
    alert: <><circle cx="12" cy="12" r="10"/><path d="M12 7v6m0 4h.01"/></>,
    filter: <><path d="M4 7h16M7 12h10M10 17h4"/></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16"/>
  };
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function parseUsernames(raw: string, filename: string): string[] {
  if (filename.toLowerCase().endsWith('.txt')) return raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const parsed = Papa.parse<string[]>(raw.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  if (parsed.errors.length) throw new Error(`CSV error on row ${parsed.errors[0].row}: ${parsed.errors[0].message}`);
  const rows = parsed.data;
  if (!rows.length) return [];
  const headers = rows[0].map(x => x.trim().toLowerCase());
  const column = headers.findIndex(x => ['username', 'player', 'ign', 'in-game name', 'ingame name'].includes(x));
  const headerFound = column !== -1;
  return rows.slice(headerFound ? 1 : 0).map(row => row[headerFound ? column : 0]?.trim() || '').filter(Boolean);
}

function displayStatus(pass: Pass, now: number): 'unused' | 'reserved' | 'claimed' {
  if (pass.status === 'reserved' && pass.reserved_until && Date.parse(pass.reserved_until) <= now) return 'unused';
  return pass.status;
}
function countdown(endsAt: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function manilaDate(value: string | null, withTime = true): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-PH', withTime ? {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  } : { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
}
function StatusPill({ status, compact = false }: { status: PassStatus; compact?: boolean }) {
  const color = status === 'claimed' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : status === 'reserved' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-slate-100 text-slate-600 ring-slate-200';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${color}`}><span className={`h-1.5 w-1.5 rounded-full ${status === 'claimed' ? 'bg-emerald-600' : status === 'reserved' ? 'bg-amber-500' : 'bg-slate-400'}`} />{compact ? status : status === 'unused' ? 'Available' : status}</span>;
}

function Metric({ label, value, icon, variant = 'default' }: { label: string; value: number | string; icon: IconName; variant?: 'default' | 'green' | 'amber' }) {
  const theme = variant === 'green' ? 'bg-[#E7F5EE] text-[#157548]' : variant === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-[#F0F5F5] text-[#31505A]';
  return <div className="rounded-[20px] border border-[#E3EAEA] bg-white px-5 py-5 shadow-[0_3px_18px_rgba(16,41,46,0.025)]">
    <div className="flex items-start justify-between gap-2"><p className="text-[13px] font-medium text-[#748489]">{label}</p><span className={`rounded-xl p-2.5 ${theme}`}><Icon name={icon} className="h-[18px] w-[18px]" /></span></div>
    <p className="mt-3 text-[30px] font-bold tracking-[-0.045em] text-[#142E34] sm:text-4xl">{typeof value === 'number' ? value.toLocaleString() : value}</p>
  </div>;
}

export default function AdminDashboard({ initiallyAuthenticated }: { initiallyAuthenticated: boolean }) {
  const [authed, setAuthed] = useState(initiallyAuthenticated);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'login' | 'generate' | 'import' | 'export' | 'zip' | 'registration' | 'clear' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [data, setData] = useState<AdminData | null>(null);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<PassStatus>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeArea, setActiveArea] = useState<'passes' | 'players'>('passes');
  const [now, setNow] = useState(Date.now());
  const [skew, setSkew] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [quantity, setQuantity] = useState(10);
  const [pendingNames, setPendingNames] = useState<string[]>([]);
  const [uploadFile, setUploadFile] = useState('');
  const [invalidUsernames, setInvalidUsernames] = useState(0);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [registrationUrl, setRegistrationUrl] = useState('');
  const [savedRegistrationUrl, setSavedRegistrationUrl] = useState('');
  const [registrationLoaded, setRegistrationLoaded] = useState(false);
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupSnapshot, setCleanupSnapshot] = useState<CleanupPreview | null>(null);
  const [cleanupPhrase, setCleanupPhrase] = useState('');
  const [cleanupAcknowledged, setCleanupAcknowledged] = useState(false);
  const [cleanupError, setCleanupError] = useState('');
  const requestSerial = useRef(0);
  const genInput = useRef<HTMLInputElement | null>(null);
  const cleanupInput = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const debounce = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(0); }, 300);
    return () => window.clearTimeout(debounce);
  }, [searchInput]);

  const refresh = useCallback(async (manual = false) => {
    const ticket = ++requestSerial.current;
    if (manual) setRefreshing(true);
    try {
      const query = new URLSearchParams({ offset: String(page * PAGE_SIZE), limit: String(PAGE_SIZE), status, search });
      const response = await fetch(`/api/admin?${query}`, { cache: 'no-store' });
      if (ticket !== requestSerial.current) return;
      if (response.status === 403) { setAuthed(false); setData(null); return; }
      const result = await response.json() as AdminData;
      if (!response.ok || !result.ok || !Array.isArray(result.passes)) throw new Error('Unable to load dashboard data.');
      if (page > 0 && page * PAGE_SIZE >= result.count) { setPage(Math.max(0, Math.ceil(result.count / PAGE_SIZE) - 1)); return; }
      setSkew(Date.parse(result.serverNow) - Date.now());
      setData(result);
      if (manual) setError('');
    } catch (e) {
      if (ticket === requestSerial.current) setError(e instanceof Error ? e.message : 'Unable to load dashboard');
    } finally {
      if (manual) setRefreshing(false);
    }
  }, [page, status, search]);

  useEffect(() => {
    if (!authed) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    const serialRef = requestSerial;
    return () => { window.clearInterval(timer); serialRef.current++; };
  }, [authed, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!generationOpen) return;
    genInput.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setGenerationOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [generationOpen]);

  useEffect(() => {
    if (!authed || activeArea !== 'players') return;
    let active = true;
    setRegistrationLoading(true);
    void fetch('/api/registration', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Unable to load registration link');
        return await response.json() as { ok: boolean; registrationUrl?: string | null };
      })
      .then(result => {
        if (!active) return;
        if (!result.ok) throw new Error('Unable to load registration link');
        const url = result.registrationUrl || '';
        setSavedRegistrationUrl(url);
        setRegistrationUrl(url);
        setRegistrationLoaded(true);
      })
      .catch(() => {
        if (active) { setRegistrationLoaded(false); setError('Unable to load registration link settings.'); }
      })
      .finally(() => { if (active) setRegistrationLoading(false); });
    return () => { active = false; };
  }, [authed, activeArea]);

  async function saveRegistrationUrl(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy !== null) return;
    setBusy('registration'); setError(''); setNotice('');
    try {
      const response = await fetch('/api/registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationUrl: registrationUrl.trim() })
      });
      const result = await response.json() as { ok: boolean; reason?: string; registrationUrl?: string | null };
      if (!response.ok || !result.ok) {
        if (result.reason === 'invalid_url') throw new Error('Enter a valid http:// or https:// registration URL (up to 2,048 characters).');
        throw new Error('Unable to save the registration link.');
      }
      const saved = result.registrationUrl || '';
      setRegistrationUrl(saved);
      setSavedRegistrationUrl(saved);
      setNotice(saved
        ? 'Registration link saved. It will appear when a username is not found.'
        : 'Registration link cleared. The Register here button stays disabled until a link is added.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to update registration link.');
    } finally {
      setBusy(null);
    }
  }

  async function login(e: FormEvent) {
    e.preventDefault(); setBusy('login'); setError('');
    try {
      const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.reason === 'too_many_attempts' ? 'Too many attempts. Try again in 15 minutes.' : 'Incorrect password or service unavailable.');
      setPassword(''); setAuthed(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed'); }
    finally { setBusy(null); }
  }
  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setAuthed(false); setData(null); setPendingNames([]);
  }
  async function mutation(body: object, kind: 'generate' | 'import') {
    setBusy(kind); setError(''); setNotice('');
    try {
      const res = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.reason || 'The operation failed');
      await refresh();
      return result;
    } catch (e) { setError(e instanceof Error ? e.message : 'The operation failed'); return null; }
    finally { setBusy(null); }
  }
  async function generate(e: FormEvent) {
    e.preventDefault();
    const result = await mutation({ action: 'generate', count: quantity }, 'generate');
    if (result) {
      setGenerationOpen(false);
      setSearchInput(''); setSearch(''); setStatus('all'); setPage(0); setActiveArea('passes');
      setNotice(`${result.generated} new QR pass${result.generated === 1 ? '' : 'es'} created. Select a pass to preview or download.`);
    }
  }
  async function fileSelected(e: ChangeEvent<HTMLInputElement>) {
    setError(''); setNotice(''); setPendingNames([]); setUploadFile(''); setConfirmReplace(false); setInvalidUsernames(0);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/\.(txt|csv)$/i.test(file.name)) { setError('Upload a .csv or .txt file.'); return; }
    if (file.size > 2 * 1024 * 1024) { setError('File must be under 2 MB.'); return; }
    try {
      const raw = parseUsernames(await file.text(), file.name).map(x => x.toLowerCase().trim());
      const invalid = raw.filter(x => x.length < 1 || x.length > 64).length;
      const names = [...new Set(raw.filter(x => x.length >= 1 && x.length <= 64))];
      if (!names.length) throw new Error('No valid usernames were found in the file.');
      if (names.length > 10000) throw new Error('Upload no more than 10,000 unique usernames.');
      setUploadFile(file.name); setPendingNames(names); setInvalidUsernames(invalid);
      setNotice(`${names.length.toLocaleString()} unique usernames ready for review.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to read file'); }
    e.target.value = '';
  }
  async function importNames() {
    if (!pendingNames.length) return;
    const result = await mutation({ action: importMode === 'replace' ? 'replace_players' : 'upsert_players', usernames: pendingNames, confirm: confirmReplace }, 'import');
    if (result) {
      setPendingNames([]); setUploadFile(''); setConfirmReplace(false); setInvalidUsernames(0);
      setNotice(importMode === 'replace'
        ? `Allowed list replaced: ${result.imported.toLocaleString()} total (${result.added} new, ${result.removed} removed).`
        : `${result.imported.toLocaleString()} usernames synchronized. Existing usernames were preserved.`);
    }
  }
  function choosePass(id: number) {
    setSelectedId(id);
    if (window.innerWidth < 1280) {
      window.requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }
  function claimUrl(key: string) { return `${window.location.origin}/claim?key=${key}`; }
  function startDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function copy(key: string) {
    try { await navigator.clipboard.writeText(claimUrl(key)); setNotice('Claim link copied to clipboard.'); setError(''); }
    catch { setError('Could not copy the link. Use a secure HTTPS page and try again.'); }
  }
  function downloadSelected(pass: Pass) {
    const canvas = document.getElementById('qr-current') as HTMLCanvasElement | null;
    if (!canvas) { setError('QR image is still rendering. Try again.'); return; }
    const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `1scan-qr-pass-${pass.id}.png`; a.click();
  }
  async function bulkZip() {
    const exportable = data?.passes.filter(pass => displayStatus(pass, Date.now() + skew) === 'unused') || [];
    if (!exportable.length) return;
    setBusy('zip'); setError(''); setNotice('');
    try {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      const entries: ZipEntry[] = exportable.map(pass => {
        const canvas = document.getElementById(`qr-export-${pass.id}`) as HTMLCanvasElement | null;
        if (!canvas) throw new Error(`QR #${pass.id} is not ready. Refresh and try again.`);
        const base64 = canvas.toDataURL('image/png').split(',')[1];
        const bytes = Uint8Array.from(atob(base64), letter => letter.charCodeAt(0));
        return { name: `1scan-qr-pass-${pass.id}.png`, data: bytes };
      });
      const bytes = zipFiles(entries);
      startDownload(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' }), `1scan-qr-passes-page-${page + 1}.zip`);
      setNotice(`Downloaded ${entries.length} available QR PNGs from this page. ZIP contains no personal details.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to create QR ZIP'); }
    finally { setBusy(null); }
  }
  async function exportPasses(exportStatus: PassStatus = status, exportSearch = search): Promise<boolean> {
    setBusy('export'); setError(''); setNotice('');
    try {
      const query = new URLSearchParams({ status: exportStatus, search: exportSearch });
      const res = await fetch(`/api/admin/export?${query}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(res.status === 413 ? 'Export exceeds the 10,000-row limit. Narrow the selection or search.' : (body.reason || 'Could not export QR results.'));
      }
      const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || '1scan-qr-' + exportStatus + '.csv';
      startDownload(await res.blob(), name);
      const selectionName = exportStatus === 'all' ? 'all QR results' :
        exportStatus === 'unused' ? 'available QR results' : exportStatus + ' QR results';
      setNotice('Exported ' + selectionName + '. Store the CSV securely: it contains QR pass keys and may include player information.');
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not export QR results'); return false; }
    finally { setBusy(null); }
  }

  async function loadCleanupPreview(preserveError = false) {
    setCleanupLoading(true);
    if (!preserveError) setCleanupError('');
    try {
      const response = await fetch('/api/admin/cleanup', { cache: 'no-store' });
      const preview = await response.json() as CleanupPreview;
      if (!response.ok || !preview.ok) throw new Error('Unable to load the latest cleanup totals.');
      setCleanupSnapshot(preview);
    } catch (e) {
      setCleanupSnapshot(null);
      setCleanupError(e instanceof Error ? e.message : 'Unable to load cleanup totals.');
    } finally { setCleanupLoading(false); }
  }

  function openCleanup() {
    if (busy !== null) return;
    setCleanupOpen(true);
    setCleanupSnapshot(null);
    setCleanupPhrase('');
    setCleanupAcknowledged(false);
    setCleanupError('');
    void loadCleanupPreview();
  }

  function closeCleanup() {
    if (busy === 'clear') return;
    setCleanupOpen(false);
    setCleanupPhrase('');
    setCleanupAcknowledged(false);
    setCleanupError('');
  }

  async function clearAllResults(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const snapshot = cleanupSnapshot;
    if (busy !== null || !snapshot || !snapshot.total || snapshot.activeReservations !== 0 ||
        !cleanupAcknowledged || cleanupPhrase !== 'CLEAR ALL QR RESULTS') return;
    setBusy('clear'); setCleanupError(''); setNotice(''); setError('');
    try {
      const response = await fetch('/api/admin/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation: cleanupPhrase,
          acknowledged: cleanupAcknowledged,
          expectedTotal: snapshot.total,
          expectedClaimed: snapshot.claimed,
          expectedMaxId: snapshot.maxId
        })
      });
      const result = await response.json() as {
        ok: boolean; reason?: string; deleted?: number; receiptsDeleted?: number;
      };
      if (!response.ok || !result.ok) {
        if (result.reason === 'results_changed') throw new Error('QR results changed after you opened the dialog. Review the updated counts and confirm again.');
        if (result.reason === 'active_reservations') throw new Error('Active QR reservations exist. Wait for the 60-second hold to expire before clearing.');
        if (result.reason === 'nothing_to_clear') throw new Error('No QR results remain to clear.');
        throw new Error('Unable to clear QR results. Nothing was deleted.');
      }
      setCleanupOpen(false);
      setCleanupSnapshot(null);
      setCleanupPhrase('');
      setCleanupAcknowledged(false);
      setSelectedId(null);
      setPage(0);
      setStatus('all');
      setSearchInput('');
      setSearch('');
      setNotice('Deleted ' + (result.deleted || 0).toLocaleString() + ' QR passes and ' +
        (result.receiptsDeleted || 0).toLocaleString() +
        ' claim receipts. Registered players and registration settings are preserved.');
      void refresh(true);
    } catch (e) {
      setCleanupError(e instanceof Error ? e.message : 'Unable to clear QR results.');
      setCleanupPhrase('');
      setCleanupAcknowledged(false);
      void loadCleanupPreview(true);
    } finally { setBusy(null); }
  }

  useEffect(() => {
    if (!cleanupOpen) return;
    cleanupInput.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && busy !== 'clear') closeCleanup();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanupOpen, busy]);

  if (!authed) return <main className="flex min-h-screen items-center justify-center bg-[#F3F7F6] px-4 py-10">
    <form onSubmit={login} className="w-full max-w-md rounded-[26px] border border-[#E2EAE8] bg-white p-8 shadow-[0_20px_80px_rgba(10,44,47,0.07)] sm:p-10">
      <div className="mb-7 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0A3939] text-white"><Icon name="qr" className="h-7 w-7" /></div>
      <h1 className="mb-8 mt-2 text-3xl font-bold tracking-tight text-[#143239]">Welcome back</h1>
      <label htmlFor="admin-password" className="block text-sm font-semibold text-[#284249]">Admin password</label>
      <input id="admin-password" type="password" autoComplete="current-password" required className="input mt-2" value={password} onChange={e => setPassword(e.target.value)} />
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button className="btn mt-6 w-full" disabled={busy === 'login'}>{busy === 'login' ? 'Signing in…' : 'Sign in securely'}</button>
    </form>
  </main>;

  const stats = data?.stats || EMPTY_STATS;
  const serverClock = now + skew;
  const selected = data?.passes.find(p => p.id === selectedId) || data?.passes[0] || null;
  const selectedStatus = selected && displayStatus(selected, serverClock);
  const pageStart = data?.count ? page * PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, data?.count || 0);
  const pageCount = Math.max(1, Math.ceil((data?.count || 0) / PAGE_SIZE));

  return <div className="min-h-screen bg-[#F5F8F8] text-[#173239] lg:flex">
    <aside className="bg-[#102E32] text-[#E8F0EF] lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[238px] lg:flex-shrink-0 lg:flex-col">
      <div className="flex items-center justify-between gap-2 px-5 py-5 lg:px-6 lg:py-7">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1D7069] text-white"><Icon name="qr" className="h-6 w-6" /></div><div><p className="text-[15px] font-bold tracking-tight">1scan</p><p className="text-[11px] font-medium tracking-wide text-[#93BAB8]">CONTROL CENTER</p></div></div>
        <button type="button" aria-label="Toggle navigation" aria-expanded={mobileNav} className="rounded-lg p-2 text-[#C7DCDD] hover:bg-white/10 lg:hidden" onClick={() => setMobileNav(!mobileNav)}><Icon name="menu" className="h-5 w-5" /></button>
      </div>
      <nav aria-label="Admin navigation" className={`${mobileNav ? 'flex' : 'hidden'} gap-1 px-3 pb-4 lg:mt-7 lg:flex lg:flex-col lg:px-3`}>
        <button type="button" onClick={() => { setActiveArea('passes'); setMobileNav(false); }} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${activeArea === 'passes' ? 'bg-[#21515A] text-white' : 'text-[#A9C5C6] hover:bg-white/10'}`}><Icon name="grid" className="h-[18px] w-[18px]" /> Pass management</button>
        <button type="button" onClick={() => { setActiveArea('players'); setMobileNav(false); }} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${activeArea === 'players' ? 'bg-[#21515A] text-white' : 'text-[#A9C5C6] hover:bg-white/10'}`}><Icon name="users" className="h-[18px] w-[18px]" /> Registered players</button>
      </nav>
      <div className="hidden border-t border-white/10 px-6 py-5 lg:mt-auto lg:block"><p className="flex items-center gap-2 text-xs font-medium text-[#A6CBC1]"><span className="h-2 w-2 rounded-full bg-[#71D3A7]" /> Protected admin area</p><p className="mt-1 text-[11px] text-[#8EAEB0]">Asia/Manila (UTC+8)</p><button className="mt-6 flex items-center gap-2 text-sm text-[#C9DEDE] hover:text-white" onClick={logout}><Icon name="logout" /> Sign out</button></div>
    </aside>

    <main className="min-w-0 flex-1 px-4 pb-14 pt-7 sm:px-7 lg:px-9 lg:pt-10 2xl:px-12">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#64868B]">Admin / {activeArea === 'passes' ? 'Pass management' : 'Registered players'}</p><h1 className="mt-1 text-[27px] font-bold tracking-[-0.04em] text-[#16343B] sm:text-[33px]">{activeArea === 'passes' ? 'QR pass dashboard' : 'Registered players'}</h1></div>
          <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => void refresh(true)} disabled={refreshing} className="admin-quiet-button" title="Refresh the current filters and page"><Icon name="refresh" className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Refresh</span></button><button type="button" onClick={() => void logout()} className="admin-quiet-button lg:hidden"><Icon name="logout" /> Sign out</button><button onClick={() => setGenerationOpen(true)} className="admin-primary-button"><Icon name="plus" /> Generate passes</button></div>
        </header>
        {(error || notice) && <div aria-live="polite" className="mb-5 space-y-2">{error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><Icon name="alert" className="mt-0.5 h-4 w-4 flex-shrink-0" />{error}<button type="button" onClick={() => setError('')} className="ml-auto" aria-label="Dismiss error"><Icon name="x" /></button></div>}{notice && <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><Icon name="check" className="mt-0.5 h-4 w-4 flex-shrink-0" />{notice}<button type="button" onClick={() => setNotice('')} className="ml-auto" aria-label="Dismiss message"><Icon name="x" /></button></div>}</div>}

        <div className="mb-7 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <Metric label="Total passes" value={data ? stats.total : '—'} icon="qr" />
          <Metric label="Available" value={data ? stats.unused : '—'} icon="key" variant="green" />
          <Metric label="Active reservations" value={data ? stats.reserved : '—'} icon="clock" variant="amber" />
          <Metric label="Claimed" value={data ? stats.claimed : '—'} icon="check" variant="green" />
        </div>

        {activeArea === 'passes' ? <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
          <section className="min-w-0 overflow-hidden rounded-[22px] border border-[#E1E9E9] bg-white shadow-[0_3px_18px_rgba(16,41,46,0.025)]">
            <div className="border-b border-[#EDF0F1] px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-bold tracking-tight">Passes & claim log</h2><p className="mt-1 text-xs text-[#7D8F93]">Select any pass to view its QR and claim details.</p></div><button type="button" disabled={busy !== null || !(data?.passes.some(pass => displayStatus(pass, serverClock) === 'unused'))} onClick={() => void bulkZip()} title="Downloads available passes on the current page only (up to 25 PNGs)" className="admin-quiet-button text-xs"><Icon name="download" /> {busy === 'zip' ? 'Preparing ZIP…' : 'Available QRs ZIP'}</button></div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex w-full items-center gap-2 rounded-xl border border-[#DDE7E8] bg-[#FAFCFC] px-3.5 py-2.5 text-[#7B9093] focus-within:border-[#359784] focus-within:ring-2 focus-within:ring-emerald-100 sm:max-w-sm"><Icon name="search" className="h-[18px] w-[18px] flex-shrink-0" /><span className="sr-only">Search passes</span><input className="min-w-0 flex-1 bg-transparent text-sm text-[#173239] outline-none placeholder:text-[#9BAAAC]" type="search" placeholder="Search pass, name, username, email" value={searchInput} maxLength={80} onChange={e => setSearchInput(e.target.value)} /></label>
                <div className="flex flex-wrap gap-2">
                  <button className="admin-quiet-button justify-center text-xs" disabled={busy !== null || !data?.count} type="button" onClick={() => void exportPasses()} title="Exports the current status filter and search across all pages">
                    <Icon name="file" />{busy === 'export' ? 'Exporting…' : status === 'all' ? 'Export all CSV' : status === 'unused' ? 'Export available CSV' : status === 'reserved' ? 'Export reserved CSV' : 'Export claimed CSV'}
                  </button>
                  <button type="button" disabled={busy !== null || !data?.stats.total} onClick={openCleanup} className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-xs font-bold text-red-700 transition hover:border-red-400 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">
                    <Icon name="alert" /> Clear all QR results
                  </button>
                </div>
              </div>
              <p className="mt-3 text-xs text-[#8A9C9E]">CSV export includes the selected status and search results across all pages (up to 10,000 entries). Clearing deletes all passes regardless of the selected filter.</p>
              <div role="group" aria-label="Filter passes by status" className="mt-4 flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[#F3F7F7] p-1">
                {(['all', 'unused', 'reserved', 'claimed'] as const).map(filter => {
                  const count = filter === 'all' ? stats.total : stats[filter];
                  return <button key={filter} type="button" aria-pressed={status === filter} onClick={() => { setStatus(filter); setPage(0); setSelectedId(null); }} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition sm:px-4 ${status === filter ? 'bg-white text-[#17453E] shadow-sm' : 'text-[#73888D] hover:text-[#294A4C]'}`}>{filter === 'all' ? 'All passes' : filter === 'unused' ? 'Available' : filter === 'reserved' ? 'Reserved' : 'Claimed'} <span className="ml-1 text-[11px] opacity-60">{data ? count.toLocaleString() : '—'}</span></button>;
                })}
              </div>
            </div>
            <div className="w-full overflow-x-auto"><table className="w-full min-w-[630px] border-collapse text-left text-sm"><thead><tr className="border-b border-[#EEF2F1] bg-[#FBFCFC] text-[11px] font-bold uppercase tracking-[.08em] text-[#90A0A2]"><th className="px-5 py-3.5 sm:pl-6">Pass</th><th className="px-3 py-3.5">Status</th><th className="px-3 py-3.5">Player</th><th className="px-3 py-3.5">Activity</th><th className="px-5 py-3.5 text-right sm:pr-6">Details</th></tr></thead>
                <tbody>{data?.passes.map(pass => {
                  const actual = displayStatus(pass, serverClock);
                  const isSelected = selected?.id === pass.id;
                  return <tr key={pass.id} className={`border-b border-[#F0F3F3] transition last:border-0 ${isSelected ? 'bg-[#F0F9F6]' : 'hover:bg-[#FAFCFC]'}`}>
                    <td className="px-5 py-4 sm:pl-6"><button type="button" aria-pressed={isSelected} onClick={() => choosePass(pass.id)} className="block text-left"><span className="font-bold text-[#213C44]">QR-{String(pass.id).padStart(4, '0')}</span><span className="mt-1 block font-mono text-[10px] text-[#91A2A5]">{pass.pass_key.slice(0, 10)}…</span></button></td>
                    <td className="px-3 py-4"><StatusPill status={actual} compact /></td>
                    <td className="max-w-[180px] px-3 py-4">{actual === 'claimed' ? <><p className="truncate font-semibold text-[#29424A]">{pass.claimed_full_name}</p><p className="mt-1 truncate text-xs text-[#899A9D]">@{pass.claimed_username}</p></> : <span className="text-xs text-[#A2AFB0]">—</span>}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-xs text-[#6E8589]">{actual === 'claimed' ? manilaDate(pass.claimed_at, false) : actual === 'reserved' && pass.reserved_until ? <span className="font-semibold text-amber-800">{countdown(pass.reserved_until, serverClock)} left</span> : manilaDate(pass.created_at, false)}</td>
                    <td className="px-5 py-4 text-right sm:pr-6"><button type="button" onClick={() => choosePass(pass.id)} aria-label={`View details for QR pass ${pass.id}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#DBE7E4] bg-white text-[#46756D] hover:border-[#91C5B2] hover:bg-[#F5FAF7]"><Icon name="chevron-right" /></button></td>
                  </tr>;
                })}</tbody></table></div>
            {!data && <div role="status" className="px-6 py-14 text-center text-sm text-[#84979A]">Loading private pass data…</div>}
            {data?.passes.length === 0 && <div className="px-6 py-14 text-center"><div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#F0F6F4] text-[#64918A]"><Icon name={search ? 'search' : 'qr'} className="h-6 w-6" /></div><p className="font-semibold text-[#315057]">{search || status !== 'all' ? 'No matching passes' : 'No passes generated yet'}</p><p className="mt-1 text-xs text-[#839598]">{search || status !== 'all' ? 'Try another search or filter.' : 'Generate your first batch to start.'}</p></div>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ECF1F0] px-5 py-4 text-xs text-[#7C8F93] sm:px-6"><span>Showing {pageStart}–{pageEnd} of {(data?.count || 0).toLocaleString()} matching passes</span><div className="flex items-center gap-2"><span className="mr-2 hidden sm:inline">Page {page + 1} of {pageCount}</span><button type="button" className="admin-page-button" disabled={page === 0} onClick={() => { setPage(p => Math.max(0, p - 1)); setSelectedId(null); }} aria-label="Previous page"><Icon name="chevron-left" /></button><button type="button" className="admin-page-button" disabled={page + 1 >= pageCount} onClick={() => { setPage(p => p + 1); setSelectedId(null); }} aria-label="Next page"><Icon name="chevron-right" /></button></div></div>
          </section>
          <div className="space-y-5 xl:sticky xl:top-6">
            <section ref={previewRef} className="rounded-[22px] border border-[#E1E9E9] bg-white p-5 shadow-[0_3px_18px_rgba(16,41,46,0.025)] sm:p-6" aria-label="Selected pass details"><div className="flex items-center justify-between"><h2 className="text-base font-bold">QR preview</h2>{selected && <StatusPill status={selectedStatus!} />}</div>
              {selected ? <><p className="mt-1 text-xs text-[#8A9B9D]">QR-{String(selected.id).padStart(4, '0')}</p><div className="mx-auto mt-5 w-fit rounded-[20px] border border-[#E5ECEA] bg-white p-4 shadow-sm"><QRCodeCanvas id="qr-current" value={claimUrl(selected.pass_key)} size={512} level="M" marginSize={4} style={{ width: 212, height: 212, maxWidth: '100%' }} /></div><p className="mt-4 text-center text-xs text-[#7F9295]">Unique pass • first valid scan reserves</p>
                <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => downloadSelected(selected)} className="admin-primary-button justify-center text-xs"><Icon name="download" /> Download PNG</button><button type="button" onClick={() => void copy(selected.pass_key)} className="admin-quiet-button justify-center text-xs"><Icon name="copy" /> Copy link</button></div>
                <div className="mt-5 border-t border-[#EBF0F0] pt-5"><p className="text-[11px] font-semibold uppercase tracking-[.1em] text-[#9AABAC]">Pass details</p><div className="mt-3 space-y-3 text-xs"><div className="flex items-start justify-between gap-3"><span className="text-[#819497]">Key</span><code className="max-w-[190px] break-all text-right font-mono text-[#355157]">{selected.pass_key}</code></div><div className="flex items-start justify-between gap-3"><span className="text-[#819497]">Created</span><span className="text-right font-medium text-[#335058]">{manilaDate(selected.created_at)}</span></div>{selectedStatus === 'reserved' && selected.reserved_until && <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 p-3 font-semibold text-amber-800"><span>Reservation ends in</span><span className="font-mono">{countdown(selected.reserved_until, serverClock)}</span></div>}</div></div>
                {selected.status === 'claimed' && <div className="mt-5 border-t border-[#EBF0F0] pt-5"><p className="mb-3 text-[11px] font-semibold uppercase tracking-[.1em] text-[#9AABAC]">Verified claimant</p><dl className="space-y-3 text-xs">{([['Full name', selected.claimed_full_name], ['Username', selected.claimed_username], ['Email', selected.claimed_email], ['Claimed (Manila)', manilaDate(selected.claimed_at)]] as const).map(([label, value]) => <div key={label}><dt className="text-[#8C9E9F]">{label}</dt><dd className="mt-1 break-words font-semibold text-[#355057]">{value || '—'}</dd></div>)}</dl></div>}
              </> : <div className="py-14 text-center text-sm text-[#92A1A3]">Select a pass from the table to view its QR code.</div>}
            </section>
          </div>
          {/* Off-screen PNG canvases: visible only to the browser's local bulk ZIP exporter. */}
          <div aria-hidden="true" className="pointer-events-none absolute -left-[100000px] top-0 h-0 w-0 overflow-hidden">{data?.passes.map(pass => <QRCodeCanvas key={pass.id} id={`qr-export-${pass.id}`} value={claimUrl(pass.pass_key)} size={512} level="M" marginSize={4} />)}</div>
        </div> : <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
          <section className="rounded-[22px] border border-[#E1E9E9] bg-white p-6 shadow-sm sm:p-8"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold tracking-tight">Import allowed usernames</h2><p className="mt-1 text-sm text-[#809197]">Upload a CSV with a <code className="rounded bg-[#F0F5F5] px-1.5 py-0.5 text-xs">username</code> column, or a TXT with one username per line.</p></div><div className="rounded-xl bg-[#EAF5F0] p-3 text-[#3E8870]"><Icon name="upload" className="h-5 w-5" /></div></div>
            <label className="mt-7 flex cursor-pointer flex-col items-center rounded-[20px] border-2 border-dashed border-[#C9DEDA] bg-[#FAFDFC] px-5 py-10 text-center hover:border-[#7EBAA8]"><span className="mb-3 rounded-full bg-[#EAF5F0] p-3 text-[#397B6D]"><Icon name="file" className="h-6 w-6" /></span><span className="font-semibold text-[#35525A]">Choose a CSV or TXT file</span><span className="mt-1 text-xs text-[#8A9B9F]">Maximum 2 MB · up to 10,000 unique usernames</span><input type="file" accept=".csv,.txt,text/plain,text/csv" onChange={fileSelected} aria-label="Upload registered usernames" className="mt-4 max-w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-[#E1F1EB] file:px-3 file:py-2 file:font-bold file:text-[#276D5E]" /></label>
            {pendingNames.length > 0 && <div className="mt-6 rounded-xl border border-[#E3EBEB] bg-[#FBFDFC] p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-[#29474E]">Import preview</h3><span className="rounded-full bg-[#E4F3ED] px-3 py-1 text-xs font-semibold text-[#25765F]">{pendingNames.length.toLocaleString()} unique</span></div><p className="mt-1 break-all text-xs text-[#84969A]">{uploadFile}</p>{invalidUsernames > 0 && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{invalidUsernames} invalid usernames were skipped (blank or over 64 characters). Replacement is disabled until you upload a corrected file.</p>}<div className="mt-4 flex flex-wrap gap-2">{pendingNames.slice(0, 16).map(name => <span key={name} className="rounded-md border border-[#DEE8E7] bg-white px-2.5 py-1.5 text-xs text-[#4A656B]">{name}</span>)}{pendingNames.length > 16 && <span className="px-2 py-1.5 text-xs text-[#8A999C]">+{pendingNames.length - 16} more</span>}</div><div className="mt-5 grid gap-2 sm:grid-cols-2" role="group" aria-label="Username import mode"><button type="button" aria-pressed={importMode === 'merge'} onClick={() => { setImportMode('merge'); setConfirmReplace(false); }} className={`rounded-xl border px-4 py-3 text-left text-xs font-semibold ${importMode === 'merge' ? 'border-[#70B39A] bg-[#E8F6EF] text-[#25634D]' : 'border-[#DBE6E6] text-[#70868C]'}`}>Merge with existing<span className="mt-1 block font-normal opacity-80">Keep usernames not in this file</span></button><button type="button" aria-pressed={importMode === 'replace'} onClick={() => { setImportMode('replace'); setConfirmReplace(false); }} className={`rounded-xl border px-4 py-3 text-left text-xs font-semibold ${importMode === 'replace' ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-[#DBE6E6] text-[#70868C]'}`}>Replace entire list<span className="mt-1 block font-normal opacity-80">Remove names absent from this file</span></button></div>
              {importMode === 'replace' && <label className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><input type="checkbox" className="mt-1 h-4 w-4 accent-amber-700" checked={confirmReplace} onChange={e => setConfirmReplace(e.target.checked)} /><span><strong>This replaces the entire allowed-usernames list.</strong> Current names absent from the uploaded file will be removed; claimed pass history will remain intact. I understand and authorize this change.</span></label>}
              <div className="mt-5 flex flex-wrap gap-3"><button disabled={busy !== null || (importMode === 'replace' && (!confirmReplace || invalidUsernames > 0))} onClick={() => void importNames()} type="button" className="admin-primary-button">{busy === 'import' ? 'Importing…' : importMode === 'replace' ? `Replace with ${pendingNames.length.toLocaleString()} usernames` : `Import ${pendingNames.length.toLocaleString()} usernames`}</button><button type="button" className="admin-quiet-button" onClick={() => { setPendingNames([]); setUploadFile(''); setConfirmReplace(false); setInvalidUsernames(0); }}>Discard</button></div></div>}
            <div className="mt-6 flex items-start gap-3 rounded-xl bg-[#F3F8F6] p-4 text-sm text-[#638177]"><Icon name="shield" className="mt-0.5 h-5 w-5 flex-shrink-0" /><p><strong className="text-[#386E5D]">Controlled synchronization.</strong> Names are trimmed, lowercased, and deduplicated. Merge keeps existing names; Replace performs an atomic database update after explicit confirmation.</p></div>
          </section>
          <section className="space-y-5"><div className="rounded-[22px] border border-[#E1E9E9] bg-white p-6"><p className="text-sm font-medium text-[#7D9194]">Registered usernames</p><p className="mt-3 text-4xl font-bold tracking-tight text-[#163B3F]">{data ? data.allowedPlayerCount.toLocaleString() : '—'}</p><p className="mt-2 text-xs text-[#8B9C9F]">Eligible for claim verification</p></div><div className="rounded-[20px] border border-[#E1E9E9] bg-white p-6"><h3 className="text-base font-bold">Sample file format</h3><pre className="mt-4 overflow-x-auto rounded-xl bg-[#17343A] p-4 text-xs leading-6 text-[#DBF6EB]">username{'\n'}player_one{'\n'}player_two{'\n'}player_three</pre><p className="mt-3 text-xs leading-5 text-[#899A9C]">The first column is used if a CSV does not contain a username header. Existing entries remain unchanged.</p></div>
              <div className="rounded-[20px] border border-[#E1E9E9] bg-white p-6">
                <div className="flex items-center gap-2"><Icon name="key" className="h-5 w-5 text-[#27816B]" /><h3 className="text-base font-bold text-[#173B40]">Registration link</h3></div>
                <p className="mt-2 text-xs leading-5 text-[#7C9295]">When a submitted player username is not found, the scan page shows “User not found in the current database” and a Register here button pointing to this URL.</p>
                <form onSubmit={saveRegistrationUrl} className="mt-5 space-y-3">
                  <label htmlFor="registration-link" className="block text-xs font-semibold text-[#36575B]">Registration page URL</label>
                  <input id="registration-link" className="input text-sm" type="url" inputMode="url" placeholder="https://your-registration-page.example" maxLength={2048} value={registrationUrl} onChange={e => setRegistrationUrl(e.target.value)} disabled={!registrationLoaded || registrationLoading || busy === 'registration'} />
                  <p className="text-xs leading-5 text-[#849A9B]">Use an http:// or https:// link. Leave blank and save to disable the button until a link is available.</p>
                  <button className="admin-primary-button w-full justify-center" type="submit" disabled={!registrationLoaded || registrationLoading || busy !== null}>
                    <Icon name="check" />{busy === 'registration' ? 'Saving…' : 'Save registration link'}
                  </button>
                </form>
                {registrationLoading && <p className="mt-3 text-xs text-[#819697]">Loading saved link…</p>}
                {savedRegistrationUrl && <a href={savedRegistrationUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 break-all text-xs font-semibold text-[#176958] underline underline-offset-2">Open saved registration page</a>}
                {registrationLoaded && !savedRegistrationUrl && <p className="mt-3 text-xs text-[#889A9C]">No registration link configured yet.</p>}
              </div>
            </section>
        </div>}
      </div>
    </main>


    {cleanupOpen && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#0D292E]/70 p-4" onMouseDown={e => { if (e.target === e.currentTarget) closeCleanup(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="clear-results-heading" aria-describedby="clear-results-description" className="my-auto w-full max-w-lg rounded-[24px] border border-red-200 bg-white p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-100 text-red-700"><Icon name="alert" className="h-6 w-6" /></span><div><p className="text-[11px] font-bold uppercase tracking-wider text-red-700">Permanent cleanup</p><h2 id="clear-results-heading" className="text-xl font-extrabold text-[#18343A]">Clear all QR results</h2></div></div>
          <button type="button" className="rounded-lg p-2 text-[#6A8185] hover:bg-slate-100" aria-label="Close cleanup dialog" onClick={closeCleanup} disabled={busy === 'clear'}><Icon name="x" /></button>
        </div>
        <p id="clear-results-description" className="mt-4 text-sm leading-6 text-[#60777C]">This removes every 1scan QR pass, including claimed and available entries, along with their associated claim receipts. <strong className="text-red-800">Existing QR links stop working, receipt recovery is lost, and the daily one-claim-per-username history is reset.</strong></p>
        {cleanupLoading ? <p className="mt-4 text-sm text-[#597378]">Checking current database totals…</p> : cleanupSnapshot &&
          <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl border border-red-100 bg-red-50 p-4 text-center">
            <div><p className="text-xl font-extrabold text-red-950">{cleanupSnapshot.total.toLocaleString()}</p><p className="text-xs text-red-800">QR passes</p></div>
            <div><p className="text-xl font-extrabold text-red-950">{cleanupSnapshot.claimed.toLocaleString()}</p><p className="text-xs text-red-800">Claimed</p></div>
            <div><p className="text-xl font-extrabold text-red-950">{cleanupSnapshot.receipts.toLocaleString()}</p><p className="text-xs text-red-800">Receipts</p></div>
          </div>}
        {cleanupSnapshot?.activeReservations ? <p role="alert" className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">There are {cleanupSnapshot.activeReservations} active reservations. Wait for their 60-second window to expire before clearing.</p> : null}
        <p className="mt-4 text-xs leading-5 text-[#647B7D]"><strong>Preserved:</strong> registered player usernames, registration page URL and admin account. The QR sequence is not reset, preventing reuse of old reference numbers.</p>
        <div className="mt-5">
          <button type="button" className="admin-quiet-button w-full justify-center" disabled={busy !== null || !cleanupSnapshot?.total} onClick={() => void exportPasses('all', '')}><Icon name="download" /> {busy === 'export' ? 'Exporting all records…' : 'Export all QR results (backup CSV)'}</button>
          <p className="mt-2 text-xs text-[#839697]">Backup includes sensitive player details and QR pass keys. Store it securely. Exports are capped at 10,000 records.</p>
        </div>
        {cleanupError && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{cleanupError}</p>}
        <form onSubmit={clearAllResults} className="mt-5 space-y-4">
          <label className="flex items-start gap-3 text-sm text-[#415F64]"><input type="checkbox" checked={cleanupAcknowledged} onChange={e => setCleanupAcknowledged(e.target.checked)} className="mt-1 h-4 w-4 accent-red-700" disabled={busy === 'clear'} /><span>I understand this is <strong>irreversible</strong>, will remove claim history and all existing QR links, and I have exported any records I need.</span></label>
          <div><label htmlFor="confirm-clear-qr" className="block text-xs font-semibold text-[#38555A]">Type <strong className="font-black text-red-800">CLEAR ALL QR RESULTS</strong> to confirm</label><input ref={cleanupInput} id="confirm-clear-qr" className="input mt-2" autoComplete="off" spellCheck={false} value={cleanupPhrase} onChange={e => setCleanupPhrase(e.target.value)} placeholder="CLEAR ALL QR RESULTS" disabled={busy === 'clear'} /></div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" className="admin-quiet-button justify-center" disabled={busy === 'clear'} onClick={closeCleanup}>Cancel</button><button type="submit" disabled={busy !== null || cleanupLoading || !cleanupSnapshot?.total || !!cleanupSnapshot?.activeReservations || !cleanupAcknowledged || cleanupPhrase !== 'CLEAR ALL QR RESULTS'} className="inline-flex items-center justify-center rounded-xl bg-red-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40">{busy === 'clear' ? 'Deleting…' : 'Permanently delete all QR results'}</button></div>
        </form>
      </div>
    </div>}
    {generationOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D292E]/60 p-4" onMouseDown={e => { if (e.target === e.currentTarget) setGenerationOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="generate-heading" className="w-full max-w-md rounded-[25px] bg-white p-7 shadow-2xl"><div className="flex items-start justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E5F5EB] text-[#2A7D65]"><Icon name="qr" className="h-6 w-6" /></span><button type="button" aria-label="Close generate dialog" onClick={() => setGenerationOpen(false)} className="rounded-lg p-2 text-[#71878B] hover:bg-[#F1F5F5]"><Icon name="x" /></button></div><h2 id="generate-heading" className="mt-5 text-2xl font-bold tracking-tight">Generate QR passes</h2><p className="mt-2 text-sm leading-6 text-[#82969A]">Each pass receives an unguessable, single-use key. Download and distribute the images when you are ready.</p><form onSubmit={generate} className="mt-6"><label htmlFor="pass-quantity" className="text-sm font-semibold text-[#345158]">Number of passes</label><input ref={genInput} id="pass-quantity" className="input mt-2" type="number" min="1" max="100" required value={quantity} onChange={e => setQuantity(Number(e.target.value))}/><p className="mt-2 text-xs text-[#88999C]">1–100 passes per batch</p>{error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}<div className="mt-7 flex justify-end gap-2"><button className="admin-quiet-button" type="button" onClick={() => setGenerationOpen(false)}>Cancel</button><button className="admin-primary-button" type="submit" disabled={busy !== null}><Icon name="plus" />{busy === 'generate' ? 'Generating…' : 'Generate passes'}</button></div></form></div>
    </div>}
  </div>;
}
