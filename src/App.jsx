import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from './supabase';

// Remove STORAGE_KEYS - using Supabase instead

const USERS = {
  staff: { password: '6891', role: 'staff' },
  admin: { password: 'L0nd0nC1ty@2022', role: 'admin' }
};

// GMT London helpers
const getGMTDateStr = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const formatTime = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Europe/London' });
const formatDate = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Europe/London' });
const getGMTMonth = (d) => parseInt(new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/London', month: 'numeric' })) - 1;
const getGMTYear = (d) => parseInt(new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/London', year: 'numeric' }));
const calcHours = (a, b) => (!a || !b) ? 0 : (new Date(b) - new Date(a)) / 3600000;
const fmtHours = (h) => { const hr = Math.floor(h); const mn = Math.round((h - hr) * 60); return `${hr}h ${mn}m`; };

const getInitials = (name) => {
  if (!name) return '';
  return name.split(' ').filter(w => w.length > 0).map(w => w[0].toUpperCase()).join('');
};

// GPS geofence — 0.1 miles ≈ 160.934 metres
const GEO_FENCE = {
  lat: 51.617404,
  lng: -0.311809,
  radiusMetres: 160.934
};

const haversineMetres = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const genHash = (data) => {
  const s = JSON.stringify(data);
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h = h & h; }
  return Math.abs(h).toString(16).padStart(8, '0');
};

// Clean records older than 6 months
const cleanOldRecords = (records) => {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const cutoff = sixMonthsAgo.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  return records.filter(r => r.date >= cutoff);
};

// Styles
const G = {
  panel: { background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(24px) saturate(1.4)', WebkitBackdropFilter: 'blur(24px) saturate(1.4)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)' },
  panelH: { background: 'rgba(255,255,255,0.09)', backdropFilter: 'blur(24px) saturate(1.4)', WebkitBackdropFilter: 'blur(24px) saturate(1.4)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 20, boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15)' },
  card: { background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)' },
  btn: { background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.1)', cursor: 'pointer', transition: 'all 0.25s ease' },
  inp: { background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff', padding: '14px 16px', fontSize: 14, outline: 'none', transition: 'border-color 0.2s', fontFamily: "'Montserrat', sans-serif" },
  acc: 'rgba(120,200,255,0.9)', grn: 'rgba(80,220,140,0.9)', red: 'rgba(255,90,90,0.9)', prp: 'rgba(180,140,255,0.9)'
};

const FONT = "'Montserrat', sans-serif";

// ─── AI ASSISTANT ───
const AIPanel = ({ employees, records, onClose }) => {
  const [msgs, setMsgs] = useState([]);
  const [inp, setInp] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const sys = `You are the YSS Attendance AI. Data:\nEMPLOYEES: ${JSON.stringify(employees)}\nRECORDS: ${JSON.stringify(records)}\nHelp with summaries, patterns, overtime. Be concise. Today: ${new Date().toLocaleDateString()}.`;

  const send = async () => {
    if (!inp.trim() || busy) return;
    const um = { role: 'user', content: inp };
    setMsgs(p => [...p, um]); setInp(''); setBusy(true);
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: sys, messages: [...msgs, um].map(m => ({ role: m.role, content: m.content })) }) });
      const d = await r.json();
      setMsgs(p => [...p, { role: 'assistant', content: d.content?.[0]?.text || 'Error.' }]);
    } catch { setMsgs(p => [...p, { role: 'assistant', content: 'Connection error.' }]); }
    setBusy(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, fontFamily: FONT }}>
      <div style={{ ...G.panel, width: '100%', maxWidth: 560, height: '75vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: G.acc }}>✦ YSS AI Assistant</span>
          <button onClick={onClose} style={{ ...G.btn, padding: '8px 18px', color: '#fff', fontFamily: FONT, fontWeight: 600, fontSize: 12 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {msgs.length === 0 && <div style={{ textAlign: 'center', marginTop: 40, color: 'rgba(255,255,255,0.4)' }}>
            <p style={{ fontSize: 14, marginBottom: 20 }}>Ask anything about attendance</p>
            {["Who worked the most this month?", "Show overtime summary", "Generate a report"].map((q, i) => (
              <button key={i} onClick={() => setInp(q)} style={{ ...G.card, display: 'block', width: '100%', padding: '12px 16px', color: 'rgba(255,255,255,0.6)', fontFamily: FONT, fontSize: 12, textAlign: 'left', cursor: 'pointer', marginBottom: 8 }}>{q}</button>
            ))}
          </div>}
          {msgs.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '82%', padding: '12px 16px', borderRadius: 14, background: m.role === 'user' ? 'rgba(120,200,255,0.2)' : 'rgba(255,255,255,0.06)', border: `1px solid ${m.role === 'user' ? 'rgba(120,200,255,0.3)' : 'rgba(255,255,255,0.08)'}`, color: '#fff', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: FONT }}>{m.content}</div>
          ))}
          {busy && <div style={{ color: G.acc, fontSize: 13 }}>Thinking...</div>}
          <div ref={end} />
        </div>
        <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: 10 }}>
          <input value={inp} onChange={e => setInp(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Ask about attendance..." style={{ ...G.inp, flex: 1 }} />
          <button onClick={send} disabled={busy} style={{ ...G.btn, padding: '12px 24px', color: G.acc, fontFamily: FONT, fontWeight: 700, fontSize: 13, opacity: busy ? 0.4 : 1 }}>Send</button>
        </div>
      </div>
    </div>
  );
};

// ─── LOGIN SCREEN ───
const LoginScreen = ({ onLogin }) => {
  const [userType, setUserType] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPw, setShowPw] = useState(false);

  const tryLogin = () => {
    const u = USERS[userType];
    if (u && password === u.password) {
      setError('');
      onLogin(u.role);
    } else {
      setError('Incorrect password');
      setPassword('');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg, #0a0e1a, #0f1628, #141e35, #0d1424)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '20%', left: '20%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(120,200,255,0.07) 0%, transparent 70%)', animation: 'float 20s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', bottom: '10%', right: '15%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(180,120,255,0.06) 0%, transparent 70%)', animation: 'float 25s ease-in-out infinite reverse' }} />
      </div>
      <style>{`@keyframes float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-30px) scale(1.05)}} @keyframes slideIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}} input::placeholder{color:rgba(255,255,255,0.25)} select option{background:#1a2035;color:#fff}`}</style>

      <div style={{ ...G.panel, padding: '48px 40px', width: '100%', maxWidth: 420, textAlign: 'center', position: 'relative', zIndex: 10, animation: 'slideIn 0.4s ease' }}>
        <div style={{ marginBottom: 32 }}>
          <span style={{ background: 'linear-gradient(135deg, rgba(120,200,255,0.2), rgba(180,120,255,0.2))', borderRadius: 16, padding: '12px 16px', fontSize: 32, border: '1px solid rgba(255,255,255,0.1)', display: 'inline-block', marginBottom: 16 }}>⏱</span>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, background: 'linear-gradient(135deg, #fff, rgba(120,200,255,0.9))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>YSS Attendance</h1>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: 2.5 }}>TAMPER-PROOF CLOCK SYSTEM</p>
        </div>

        {!userType ? (
          <div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 24 }}>Select your role to continue</p>
            <div style={{ display: 'flex', gap: 14 }}>
              <button onClick={() => setUserType('staff')} style={{ ...G.btn, flex: 1, padding: '28px 20px', fontFamily: FONT, fontWeight: 600, fontSize: 15, color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 28 }}>👤</span>
                Staff
              </button>
              <button onClick={() => setUserType('admin')} style={{ ...G.btn, flex: 1, padding: '28px 20px', fontFamily: FONT, fontWeight: 600, fontSize: 15, color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, borderColor: 'rgba(180,140,255,0.25)' }}>
                <span style={{ fontSize: 28 }}>🛡️</span>
                Admin
              </button>
            </div>
          </div>
        ) : (
          <div style={{ animation: 'slideIn 0.3s ease' }}>
            <div style={{ ...G.card, padding: '10px 16px', display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
              <span>{userType === 'admin' ? '🛡️' : '👤'}</span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', textTransform: 'capitalize' }}>{userType}</span>
            </div>
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && tryLogin()}
                placeholder="Enter password"
                autoFocus
                style={{ ...G.inp, width: '100%', boxSizing: 'border-box', paddingRight: 50, borderColor: error ? 'rgba(255,90,90,0.4)' : 'rgba(255,255,255,0.1)' }}
              />
              <button onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 13, fontFamily: FONT }}>{showPw ? 'Hide' : 'Show'}</button>
            </div>
            {error && <p style={{ color: G.red, fontSize: 12, margin: '0 0 16px' }}>{error}</p>}
            <button onClick={tryLogin} style={{ ...G.btn, width: '100%', padding: 16, fontFamily: FONT, fontWeight: 700, fontSize: 15, color: G.acc }}>Login</button>
            <button onClick={() => { setUserType(null); setPassword(''); setError(''); }} style={{ marginTop: 16, background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontFamily: FONT, fontSize: 12, cursor: 'pointer' }}>← Back to role selection</button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── MAIN APP ───
export default function AttendanceApp() {
  const [role, setRole] = useState(null); // null | 'staff' | 'admin'
  const [staffEmployee, setStaffEmployee] = useState(null); // For staff: which employee they are
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [view, setView] = useState('overview');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(() => getGMTMonth(new Date()));
  const [selectedYear, setSelectedYear] = useState(() => getGMTYear(new Date()));
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmp, setNewEmp] = useState({ name: '', department: '', pin: '', payType: 'bank_cash', onHourRate: '12.21', offHourRate: '12.21' });
  const [clockPin, setClockPin] = useState('');
  const [clockEmployee, setClockEmployee] = useState(null);
  const [notif, setNotif] = useState(null);
  const [showAI, setShowAI] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(null);
  const [geoChecking, setGeoChecking] = useState(false);
  const [overrideEmp, setOverrideEmp] = useState(null);
  const [salaryMonth, setSalaryMonth] = useState(() => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { month: prev.getMonth(), year: prev.getFullYear() };
  });
  const [showEditEmployee, setShowEditEmployee] = useState(null);
  const [backdatedEntry, setBackdatedEntry] = useState({ date: '', clockIn: '', clockOut: '' });
  const [payments, setPayments] = useState({}); // { 'empId-month-year': amount }
  const [showPayModal, setShowPayModal] = useState(null); // { emp, month, year }
  const [showPaidHistory, setShowPaidHistory] = useState(null); // employee object
  const [showExport, setShowExport] = useState(false);
  const [showEditRecord, setShowEditRecord] = useState(null); // { record, editClockIn, editClockOut, editDate }

  // ═══════════════════════════════════════════════════════════════
  // SUPABASE DATA LOADING
  // ═══════════════════════════════════════════════════════════════
  const loadData = async () => {
    try {
      // Load employees
      const { data: empData, error: empError } = await supabase
        .from('yss_employees')
        .select('*')
        .order('created_at', { ascending: true });
      
      if (empError) throw empError;
      
      const formattedEmployees = (empData || []).map(e => ({
        id: e.id,
        name: e.name,
        department: e.department,
        pin: e.pin,
        payType: e.pay_type,
        onHourRate: parseFloat(e.on_hour_rate),
        offHourRate: parseFloat(e.off_hour_rate),
        createdAt: e.created_at
      }));
      setEmployees(formattedEmployees);

      // Load records
      const { data: recData, error: recError } = await supabase
        .from('yss_records')
        .select('*')
        .order('clock_in', { ascending: false });
      
      if (recError) throw recError;
      
      const formattedRecords = cleanOldRecords((recData || []).map(r => ({
        id: r.id,
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        date: r.date,
        clockIn: r.clock_in,
        clockOut: r.clock_out,
        hash: r.hash,
        backdated: r.backdated,
        createdBy: r.created_by || 'staff'
      })));
      setRecords(formattedRecords);

      // Load payments
      const { data: payData, error: payError } = await supabase
        .from('yss_payments')
        .select('*');
      
      if (payError) throw payError;
      
      const paymentsObj = {};
      (payData || []).forEach(p => {
        paymentsObj[`${p.employee_id}-${p.month}-${p.year}`] = parseFloat(p.amount);
      });
      setPayments(paymentsObj);

    } catch (err) {
      console.error('Load error:', err);
      notify('Failed to load data', 'error');
    }
    setLoaded(true);
  };

  // Load data on mount and set up real-time subscription
  useEffect(() => {
    loadData();
    
    // Real-time subscription for live updates across devices
    const subscription = supabase
      .channel('yss_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'yss_employees' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'yss_records' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'yss_payments' }, loadData)
      .subscribe();

    return () => { supabase.removeChannel(subscription); };
  }, []);

  // Clock tick
  useEffect(() => { const iv = setInterval(() => setCurrentTime(new Date()), 1000); return () => clearInterval(iv); }, []);

  const notify = (msg, type = 'success') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 3500); };

  const addEmployee = async () => {
    if (!newEmp.name || !newEmp.pin || newEmp.pin.length !== 4) { notify('Enter name and 4-digit PIN', 'error'); return; }
    if (employees.some(e => e.pin === newEmp.pin)) { notify('PIN already in use', 'error'); return; }
    
    const emp = {
      id: Date.now().toString(),
      name: newEmp.name,
      department: newEmp.department || 'General',
      pin: newEmp.pin,
      pay_type: newEmp.payType,
      on_hour_rate: parseFloat(newEmp.onHourRate) || 12.21,
      off_hour_rate: parseFloat(newEmp.offHourRate) || 12.21
    };

    const { error } = await supabase.from('yss_employees').insert([emp]);
    if (error) { notify('Failed to add employee', 'error'); console.error(error); return; }
    
    setNewEmp({ name: '', department: '', pin: '', payType: 'bank_cash', onHourRate: '12.21', offHourRate: '12.21' });
    setShowAddEmployee(false);
    notify(`${emp.name} added!`);
    loadData();
  };

  const deleteEmployee = async (id, name) => {
    if (!confirm(`Remove ${name}? Records will also be deleted.`)) return;
    
    const { error } = await supabase.from('yss_employees').delete().eq('id', id);
    if (error) { notify('Failed to delete employee', 'error'); console.error(error); return; }
    
    setSelectedEmployee(null);
    notify(`${name} removed`);
    loadData();
  };

  // Staff login via PIN
  const handleStaffPin = () => {
    const emp = employees.find(e => e.pin === clockPin);
    if (emp) { setStaffEmployee(emp); setClockPin(''); }
    else { notify('Invalid PIN', 'error'); setClockPin(''); }
  };

  // Admin clock PIN
  const handleAdminClockPin = () => {
    const emp = employees.find(e => e.pin === clockPin);
    if (emp) { setClockEmployee(emp); setClockPin(''); }
    else { notify('Invalid PIN', 'error'); setClockPin(''); }
  };

  const doClockAction = async (action, employee, isAdmin = false) => {
    if (!employee) return;
    const now = new Date();
    const todayStr = getGMTDateStr(now);

    if (action === 'in') {
      const anyOpen = records.find(r => r.employeeId === employee.id && r.clockIn && !r.clockOut);
      if (anyOpen) { notify('Already clocked in!', 'error'); setClockEmployee(null); return; }
      
      const rec = {
        id: Date.now().toString(),
        employee_id: employee.id,
        employee_name: employee.name,
        date: todayStr,
        clock_in: now.toISOString(),
        clock_out: null,
        hash: null,
        created_by: isAdmin ? 'admin' : 'staff'
      };
      rec.hash = genHash({ ...rec, hash: undefined });
      
      const { error } = await supabase.from('yss_records').insert([rec]);
      if (error) { notify('Failed to clock in', 'error'); console.error(error); return; }
      
      notify(`${employee.name} clocked IN at ${formatTime(now)}`);
    } else {
      const open = records.find(r => r.employeeId === employee.id && r.clockIn && !r.clockOut);
      if (!open) { notify('Not clocked in!', 'error'); setClockEmployee(null); return; }
      
      const clockOutTime = now.toISOString();
      const hash = genHash({ ...open, clockOut: clockOutTime, hash: undefined });
      
      const { error } = await supabase
        .from('yss_records')
        .update({ clock_out: clockOutTime, hash })
        .eq('id', open.id);
      
      if (error) { notify('Failed to clock out', 'error'); console.error(error); return; }
      
      notify(`${employee.name} clocked OUT — ${fmtHours(calcHours(open.clockIn, now))} worked`);
    }
    setClockEmployee(null);
    loadData();
  };

  // Create backdated entry (admin only)
  const createBackdatedEntry = async (employee) => {
    if (!employee) return;
    if (!backdatedEntry.date || !backdatedEntry.clockIn || !backdatedEntry.clockOut) {
      notify('Please fill in date, clock in time, and clock out time', 'error');
      return;
    }

    const dateStr = backdatedEntry.date;
    const clockInTime = backdatedEntry.clockIn;
    const clockOutTime = backdatedEntry.clockOut;

    const clockInISO = new Date(`${dateStr}T${clockInTime}:00`).toISOString();
    const clockOutISO = new Date(`${dateStr}T${clockOutTime}:00`).toISOString();

    if (new Date(clockOutISO) <= new Date(clockInISO)) {
      notify('Clock out time must be after clock in time', 'error');
      return;
    }

    const rec = {
      id: Date.now().toString(),
      employee_id: employee.id,
      employee_name: employee.name,
      date: dateStr,
      clock_in: clockInISO,
      clock_out: clockOutISO,
      hash: null,
      backdated: true,
      created_by: 'admin'
    };
    rec.hash = genHash({ ...rec, hash: undefined });
    
    const { error } = await supabase.from('yss_records').insert([rec]);
    if (error) { notify('Failed to add backdated entry', 'error'); console.error(error); return; }
    
    const hours = calcHours(clockInISO, clockOutISO);
    notify(`Backdated entry added: ${employee.name} — ${fmtHours(hours)} on ${formatDate(dateStr + 'T12:00:00Z')}`);
    setBackdatedEntry({ date: '', clockIn: '', clockOut: '' });
    setOverrideEmp(null);
    loadData();
  };

  // Update attendance record (admin only)
  const updateRecord = async (recordId, newDate, newClockIn, newClockOut) => {
    const clockInISO = new Date(`${newDate}T${newClockIn}:00`).toISOString();
    const clockOutISO = new Date(`${newDate}T${newClockOut}:00`).toISOString();

    if (new Date(clockOutISO) <= new Date(clockInISO)) {
      notify('Clock out time must be after clock in time', 'error');
      return false;
    }

    const hash = genHash({ date: newDate, clock_in: clockInISO, clock_out: clockOutISO });

    const { error } = await supabase
      .from('yss_records')
      .update({ 
        date: newDate, 
        clock_in: clockInISO, 
        clock_out: clockOutISO,
        hash 
      })
      .eq('id', recordId);

    if (error) { notify('Failed to update record', 'error'); console.error(error); return false; }
    
    notify('Record updated successfully');
    loadData();
    return true;
  };

  // Delete attendance record (admin only)
  const deleteRecord = async (recordId) => {
    if (!confirm('Delete this attendance record? This cannot be undone.')) return;
    
    const { error } = await supabase.from('yss_records').delete().eq('id', recordId);
    if (error) { notify('Failed to delete record', 'error'); console.error(error); return; }
    
    notify('Record deleted');
    loadData();
  };

  // GPS-verified clock action for staff
  const clockAction = (action, employee) => {
    if (!employee || geoChecking) return;
    setGeoChecking(true);

    if (!navigator.geolocation) {
      notify('Location not supported by your browser', 'error');
      setGeoChecking(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const dist = haversineMetres(pos.coords.latitude, pos.coords.longitude, GEO_FENCE.lat, GEO_FENCE.lng);
        if (dist <= GEO_FENCE.radiusMetres) {
          doClockAction(action, employee, false); // Staff clock - isAdmin=false
        } else {
          const miles = (dist / 1609.344).toFixed(2);
          notify(`You are ${miles} miles away from the workplace. Clock ${action} denied.`, 'error');
        }
        setGeoChecking(false);
      },
      (err) => {
        if (err.code === 1) notify('Location access denied. Please enable GPS to clock in/out.', 'error');
        else if (err.code === 2) notify('Location unavailable. Please try again.', 'error');
        else notify('Location request timed out. Please try again.', 'error');
        setGeoChecking(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const getMonthlyHours = (eid, m, y) => {
    // Completed records
    const completed = records.filter(r => { 
      if (r.employeeId !== eid || !r.clockOut) return false; 
      const p = r.date.split('-'); 
      return parseInt(p[1]) - 1 === m && parseInt(p[0]) === y; 
    }).reduce((t, r) => t + calcHours(r.clockIn, r.clockOut), 0);
    
    // Add active session if in current month
    const now = new Date();
    const currentMonth = getGMTMonth(now);
    const currentYear = getGMTYear(now);
    if (m === currentMonth && y === currentYear) {
      const activeRec = records.find(r => r.employeeId === eid && r.clockIn && !r.clockOut);
      if (activeRec) {
        return completed + calcHours(activeRec.clockIn, now.toISOString());
      }
    }
    return completed;
  };
  const getDailyRecs = (eid, m, y) => records.filter(r => { if (r.employeeId !== eid) return false; const p = r.date.split('-'); return parseInt(p[1]) - 1 === m && parseInt(p[0]) === y; }).sort((a, b) => new Date(b.clockIn) - new Date(a.clockIn));
  const verifyRec = (r) => genHash({ ...r, hash: undefined }) === r.hash;
  const isClockedIn = (eid) => records.some(r => r.employeeId === eid && r.clockIn && !r.clockOut);
  const getDaysWorked = (eid, m, y) => { 
    const s = new Set(); 
    // Completed records
    records.filter(r => { if (r.employeeId !== eid || !r.clockOut) return false; const p = r.date.split('-'); return parseInt(p[1]) - 1 === m && parseInt(p[0]) === y; }).forEach(r => s.add(r.date)); 
    // Add today if currently clocked in
    const now = new Date();
    const currentMonth = getGMTMonth(now);
    const currentYear = getGMTYear(now);
    if (m === currentMonth && y === currentYear) {
      const activeRec = records.find(r => r.employeeId === eid && r.clockIn && !r.clockOut);
      if (activeRec) s.add(activeRec.date);
    }
    return s.size; 
  };
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Double shift: count completed shifts per employee per date
  const getShiftNumber = (record) => {
    const sameDay = records.filter(r => r.employeeId === record.employeeId && r.date === record.date && r.clockOut).sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn));
    const idx = sameDay.findIndex(r => r.id === record.id);
    if (sameDay.length > 1) return { num: idx + 1, total: sameDay.length, isDouble: true };
    return { num: 1, total: 1, isDouble: false };
  };

  const shiftLabel = (record) => {
    const s = getShiftNumber(record);
    if (!s.isDouble) return null;
    return `Shift ${s.num}/${s.total}`;
  };

  // Salary calculation helpers
  const BANK_HOUR_CAP = 67; // Hours after which pay goes to cash for bank_cash employees
  const roundHours = (h) => Math.round(h * 100) / 100; // Round to 2 decimal places

  const calculateSalary = (emp, month, year) => {
    const monthRecords = records.filter(r => {
      if (r.employeeId !== emp.id || !r.clockOut) return false;
      const p = r.date.split('-');
      return parseInt(p[1]) - 1 === month && parseInt(p[0]) === year;
    });

    const rawTotalHours = monthRecords.reduce((t, r) => t + calcHours(r.clockIn, r.clockOut), 0);
    const totalHours = roundHours(rawTotalHours);
    const onRate = emp.onHourRate || 12.21;
    const offRate = emp.offHourRate || 12.21;

    if (emp.payType === 'cash_only') {
      // All hours are off-hours (cash only)
      const cashPay = roundHours(totalHours * offRate * 100) / 100; // Round pay to 2 decimals
      return {
        totalHours,
        onHours: 0,
        offHours: totalHours,
        onRate,
        offRate,
        bankPay: 0,
        cashPay,
        totalPay: cashPay,
        payType: 'cash_only'
      };
    } else {
      // bank_cash: first 67 hours are on-hours (bank), rest are off-hours (cash)
      const onHours = roundHours(Math.min(totalHours, BANK_HOUR_CAP));
      const offHours = roundHours(Math.max(0, totalHours - BANK_HOUR_CAP));
      const bankPay = Math.round(onHours * onRate * 100) / 100; // Round pay to 2 decimals
      const cashPay = Math.round(offHours * offRate * 100) / 100;
      return {
        totalHours,
        onHours,
        offHours,
        onRate,
        offRate,
        bankPay,
        cashPay,
        totalPay: Math.round((bankPay + cashPay) * 100) / 100,
        payType: 'bank_cash'
      };
    }
  };

  const formatCurrency = (amount) => `£${(Math.round(amount * 100) / 100).toFixed(2)}`;

  // Get total paid till date for an employee
  const getEmployeePaidTotal = (empId) => {
    return Object.entries(payments)
      .filter(([key]) => key.startsWith(`${empId}-`))
      .reduce((sum, [, amount]) => sum + amount, 0);
  };

  // Get paid history by month for an employee
  const getEmployeePaidHistory = (empId) => {
    return Object.entries(payments)
      .filter(([key]) => key.startsWith(`${empId}-`))
      .map(([key, amount]) => {
        const parts = key.split('-');
        const month = parseInt(parts[1]);
        const year = parseInt(parts[2]);
        return { month, year, amount, label: `${months[month]} ${year}` };
      })
      .sort((a, b) => (b.year - a.year) || (b.month - a.month));
  };

  // Get previous month for salary generation
  const getPrevMonth = () => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { month: prev.getMonth(), year: prev.getFullYear() };
  };

  // Admin search state
  const [searchName, setSearchName] = useState('');
  const [searchMonth, setSearchMonth] = useState('all');

  // Available months (last 6)
  const availableMonths = useMemo(() => {
    const result = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      result.push({ month: d.getMonth(), year: d.getFullYear(), label: `${months[d.getMonth()]} ${d.getFullYear()}` });
    }
    return result;
  }, []);

  // Export functions
  const downloadCSV = (content, filename) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportAttendance = (month, year) => {
    const monthRecords = records.filter(r => {
      if (!r.clockOut) return false;
      const p = r.date.split('-');
      return parseInt(p[1]) - 1 === month && parseInt(p[0]) === year;
    }).sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn));

    const headers = ['Employee Name', 'Department', 'Date', 'Clock In', 'Clock Out', 'Hours Worked'];
    const rows = monthRecords.map(r => {
      const emp = employees.find(e => e.id === r.employeeId);
      return [
        r.employeeName,
        emp?.department || 'N/A',
        r.date,
        formatTime(r.clockIn),
        formatTime(r.clockOut),
        calcHours(r.clockIn, r.clockOut).toFixed(2)
      ];
    });

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    downloadCSV(csv, `YSS_Attendance_${months[month]}_${year}.csv`);
    notify(`Attendance exported for ${months[month]} ${year}`);
  };

  const exportSalary = (month, year) => {
    const headers = ['Employee Name', 'Department', 'Pay Type', 'Total Hours', 'On Hours', 'Off Hours', 'On Rate', 'Off Rate', 'Bank Pay', 'Cash Pay', 'Net Pay', 'Paid', 'Pending'];
    const rows = employees.map(emp => {
      const s = calculateSalary(emp, month, year);
      const payKey = `${emp.id}-${month}-${year}`;
      const paid = payments[payKey] || 0;
      const pending = Math.max(0, s.totalPay - paid);
      return [
        emp.name,
        emp.department,
        emp.payType === 'bank_cash' ? 'Bank + Cash' : 'Cash Only',
        s.totalHours.toFixed(2),
        s.onHours.toFixed(2),
        s.offHours.toFixed(2),
        s.onRate.toFixed(2),
        s.offRate.toFixed(2),
        s.bankPay.toFixed(2),
        s.cashPay.toFixed(2),
        s.totalPay.toFixed(2),
        paid.toFixed(2),
        pending.toFixed(2)
      ];
    });

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    downloadCSV(csv, `YSS_Salary_${months[month]}_${year}.csv`);
    notify(`Salary exported for ${months[month]} ${year}`);
  };

  const exportAllAttendance = () => {
    const allRecords = records.filter(r => r.clockOut).sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn));
    const headers = ['Employee Name', 'Department', 'Date', 'Clock In', 'Clock Out', 'Hours Worked'];
    const rows = allRecords.map(r => {
      const emp = employees.find(e => e.id === r.employeeId);
      return [
        r.employeeName,
        emp?.department || 'N/A',
        r.date,
        formatTime(r.clockIn),
        formatTime(r.clockOut),
        calcHours(r.clockIn, r.clockOut).toFixed(2)
      ];
    });

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    downloadCSV(csv, `YSS_Attendance_All.csv`);
    notify('All attendance records exported');
  };

  // ─── LOGIN ───
  if (!role) return <LoginScreen onLogin={setRole} />;

  // ─── STAFF VIEW ───
  if (role === 'staff' && !staffEmployee) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg, #0a0e1a, #0f1628, #141e35, #0d1424)', fontFamily: FONT, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: '15%', left: '20%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(120,200,255,0.06) 0%, transparent 70%)', animation: 'float 20s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', bottom: '20%', right: '15%', width: 450, height: 450, borderRadius: '50%', background: 'radial-gradient(circle, rgba(180,120,255,0.05) 0%, transparent 70%)', animation: 'float 25s ease-in-out infinite reverse' }} />
        </div>
        <style>{`@keyframes float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-30px) scale(1.05)}} @keyframes slideIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}} input::placeholder{color:rgba(255,255,255,0.25)}`}</style>
        {notif && <div style={{ position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 200, ...G.panel, padding: '14px 32px', borderColor: notif.type === 'error' ? 'rgba(255,90,90,0.4)' : 'rgba(80,220,140,0.4)', color: notif.type === 'error' ? G.red : G.grn, fontWeight: 600, fontSize: 14, animation: 'slideIn 0.3s ease' }}>{notif.type === 'error' ? '✕ ' : '✓ '}{notif.msg}</div>}

        <div style={{ ...G.panel, padding: '48px 40px', maxWidth: 400, width: '100%', textAlign: 'center', position: 'relative', zIndex: 10, animation: 'slideIn 0.4s ease' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: '#fff' }}>Staff Login</h2>
          <p style={{ margin: '0 0 32px', fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: 2 }}>ENTER YOUR 4-DIGIT PIN</p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 28 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ ...G.card, width: 52, height: 62, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: G.acc, borderColor: clockPin.length > i ? 'rgba(120,200,255,0.4)' : 'rgba(255,255,255,0.08)', boxShadow: clockPin.length > i ? '0 0 12px rgba(120,200,255,0.15)' : G.card.boxShadow, transition: 'all 0.2s' }}>
                {clockPin[i] ? '●' : ''}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 68px)', gap: 8, justifyContent: 'center' }}>
            {[1,2,3,4,5,6,7,8,9,'C',0,'→'].map(k => (
              <button key={k} onClick={() => { if (k === 'C') setClockPin(''); else if (k === '→') handleStaffPin(); else if (clockPin.length < 4) setClockPin(p => p + k); }}
                style={{ ...G.btn, width: 68, height: 68, fontFamily: FONT, fontSize: 20, fontWeight: 600, color: k === '→' ? '#000' : '#fff', background: k === '→' ? G.acc : k === 'C' ? 'rgba(255,90,90,0.15)' : G.btn.background, borderColor: k === '→' ? 'rgba(120,200,255,0.4)' : k === 'C' ? 'rgba(255,90,90,0.3)' : G.btn.borderColor }}>
                {k}
              </button>
            ))}
          </div>
          <button onClick={() => { setRole(null); setClockPin(''); }} style={{ marginTop: 24, background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontFamily: FONT, fontSize: 12, cursor: 'pointer' }}>← Logout</button>
        </div>
      </div>
    );
  }

  // ─── STAFF DASHBOARD ───
  if (role === 'staff' && staffEmployee) {
    const emp = staffEmployee;
    const active = isClockedIn(emp.id);
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg, #0a0e1a, #0f1628, #141e35, #0d1424)', fontFamily: FONT, color: '#fff', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
          <div style={{ position: 'absolute', top: '10%', left: '15%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(120,200,255,0.06) 0%, transparent 70%)', animation: 'float 20s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', bottom: '15%', right: '10%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(180,120,255,0.05) 0%, transparent 70%)', animation: 'float 25s ease-in-out infinite reverse' }} />
        </div>
        <style>{`@keyframes float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-30px) scale(1.05)}} @keyframes slideIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}} select option{background:#1a2035;color:#fff} ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}`}</style>

        {notif && <div style={{ position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 200, ...G.panel, padding: '14px 32px', borderColor: notif.type === 'error' ? 'rgba(255,90,90,0.4)' : 'rgba(80,220,140,0.4)', color: notif.type === 'error' ? G.red : G.grn, fontWeight: 600, fontSize: 14, animation: 'slideIn 0.3s ease' }}>{notif.type === 'error' ? '✕ ' : '✓ '}{notif.msg}</div>}

        {/* Header */}
        <header style={{ position: 'relative', zIndex: 10, padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ background: 'linear-gradient(135deg, rgba(120,200,255,0.2), rgba(180,120,255,0.2))', borderRadius: 12, padding: '6px 10px', fontSize: 18, border: '1px solid rgba(255,255,255,0.1)' }}>⏱</span>
              <span style={{ background: 'linear-gradient(135deg, #fff, rgba(120,200,255,0.9))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>YSS Attendance</span>
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>👤 {getInitials(emp.name)}</span>
            <button onClick={() => { setStaffEmployee(null); setClockPin(''); setView('overview'); }} style={{ ...G.btn, padding: '10px 18px', color: G.red, fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>Logout</button>
          </div>
        </header>

        {/* No nav for staff - clock only */}

        <main style={{ position: 'relative', zIndex: 10, padding: 28, maxWidth: 960, margin: '0 auto' }}>
          {/* Staff Clock - always shown */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ ...G.panel, padding: '48px 40px', marginBottom: 28 }}>
              <div style={{ fontSize: 72, fontWeight: 200, color: '#fff', letterSpacing: 4, textShadow: '0 0 40px rgba(120,200,255,0.2)' }}>{currentTime.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Europe/London' })}</div>
              <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.4)', marginTop: 12, letterSpacing: 2.5, fontWeight: 500 }}>{formatDate(currentTime)} • <span style={{ color: G.acc }}>GMT</span></div>
            </div>

            <div style={{ ...G.panel, padding: '40px 36px', maxWidth: 440, margin: '0 auto' }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: 3, marginBottom: 6 }}>WELCOME</div>
              <div style={{ fontSize: 42, fontWeight: 700, color: '#fff', marginBottom: 32, letterSpacing: 2 }}>{getInitials(emp.name)}</div>

              {active && (() => {
                const openRec = records.find(r => r.employeeId === emp.id && r.clockIn && !r.clockOut);
                return (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ ...G.card, padding: '12px 20px', display: 'inline-block', borderColor: 'rgba(80,220,140,0.3)', background: 'rgba(80,220,140,0.06)' }}>
                      <span style={{ color: G.grn, fontSize: 12, fontWeight: 600, animation: 'pulse 2s infinite' }}>● Currently Clocked In</span>
                    </div>
                    {openRec && (
                      <div style={{ marginTop: 12, ...G.card, padding: '14px 22px', display: 'inline-block', borderColor: 'rgba(120,200,255,0.2)', background: 'rgba(120,200,255,0.05)' }}>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: 2, marginBottom: 4 }}>CLOCKED IN AT</div>
                        <div style={{ fontSize: 22, fontWeight: 600, color: G.acc, letterSpacing: 1 }}>{formatTime(openRec.clockIn)}</div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
                <button onClick={() => clockAction('in', emp)} disabled={geoChecking} style={{ ...G.btn, padding: '22px 44px', fontFamily: FONT, fontSize: 16, fontWeight: 700, color: '#fff', background: 'rgba(80,220,140,0.15)', borderColor: 'rgba(80,220,140,0.35)', boxShadow: '0 4px 20px rgba(80,220,140,0.15)', opacity: geoChecking ? 0.5 : 1 }}>{geoChecking ? '📍 Checking...' : 'CLOCK IN'}</button>
                <button onClick={() => clockAction('out', emp)} disabled={geoChecking} style={{ ...G.btn, padding: '22px 44px', fontFamily: FONT, fontSize: 16, fontWeight: 700, color: '#fff', background: 'rgba(255,90,90,0.15)', borderColor: 'rgba(255,90,90,0.35)', boxShadow: '0 4px 20px rgba(255,90,90,0.15)', opacity: geoChecking ? 0.5 : 1 }}>{geoChecking ? '📍 Checking...' : 'CLOCK OUT'}</button>
              </div>
              <div style={{ marginTop: 20, fontSize: 10, color: 'rgba(255,255,255,0.2)', letterSpacing: 1.5 }}>📍 GPS LOCATION VERIFIED</div>
            </div>
          </div>

        </main>
      </div>
    );
  }

  // ─── ADMIN DASHBOARD ───
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg, #0a0e1a, #0f1628, #141e35, #0d1424)', fontFamily: FONT, color: '#fff', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '10%', left: '15%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(120,200,255,0.06) 0%, transparent 70%)', animation: 'float 20s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', bottom: '15%', right: '10%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(180,120,255,0.05) 0%, transparent 70%)', animation: 'float 25s ease-in-out infinite reverse' }} />
        <div style={{ position: 'absolute', top: '50%', left: '60%', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(80,220,180,0.04) 0%, transparent 70%)', animation: 'float 18s ease-in-out infinite' }} />
      </div>
      <style>{`@keyframes float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-30px) scale(1.05)}} @keyframes slideIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}} input::placeholder{color:rgba(255,255,255,0.25)} select option{background:#1a2035;color:#fff} ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}`}</style>

      {notif && <div style={{ position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 200, ...G.panel, padding: '14px 32px', borderColor: notif.type === 'error' ? 'rgba(255,90,90,0.4)' : 'rgba(80,220,140,0.4)', color: notif.type === 'error' ? G.red : G.grn, fontWeight: 600, fontSize: 14, animation: 'slideIn 0.3s ease' }}>{notif.type === 'error' ? '✕ ' : '✓ '}{notif.msg}</div>}
      {showAI && <AIPanel employees={employees} records={records} onClose={() => setShowAI(false)} />}

      {/* Add Employee Modal */}
      {showAddEmployee && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ ...G.panel, padding: 32, width: 440, maxHeight: '90vh', overflow: 'auto', animation: 'slideIn 0.3s ease' }}>
            <h3 style={{ margin: '0 0 24px', color: '#fff', fontSize: 18, fontWeight: 600 }}>Add New Employee</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input placeholder="Full Name" value={newEmp.name} onChange={e => setNewEmp(p => ({ ...p, name: e.target.value }))} style={{ ...G.inp }} />
              <input placeholder="Department (e.g., FOH, BOH)" value={newEmp.department} onChange={e => setNewEmp(p => ({ ...p, department: e.target.value }))} style={{ ...G.inp }} />
              <input placeholder="4-Digit PIN (Staff Login)" type="password" maxLength={4} value={newEmp.pin} onChange={e => setNewEmp(p => ({ ...p, pin: e.target.value.replace(/\D/g, '') }))} style={{ ...G.inp }} />
              
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 10, fontWeight: 600 }}>PAYMENT TYPE</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setNewEmp(p => ({ ...p, payType: 'bank_cash' }))} 
                    style={{ ...G.btn, flex: 1, padding: '14px 12px', fontFamily: FONT, fontSize: 11, fontWeight: 600, color: newEmp.payType === 'bank_cash' ? '#fff' : 'rgba(255,255,255,0.4)', background: newEmp.payType === 'bank_cash' ? 'rgba(120,200,255,0.15)' : 'rgba(255,255,255,0.03)', borderColor: newEmp.payType === 'bank_cash' ? 'rgba(120,200,255,0.4)' : 'rgba(255,255,255,0.08)' }}>
                    🏦 Bank + Cash
                  </button>
                  <button onClick={() => setNewEmp(p => ({ ...p, payType: 'cash_only' }))} 
                    style={{ ...G.btn, flex: 1, padding: '14px 12px', fontFamily: FONT, fontSize: 11, fontWeight: 600, color: newEmp.payType === 'cash_only' ? '#fff' : 'rgba(255,255,255,0.4)', background: newEmp.payType === 'cash_only' ? 'rgba(80,220,140,0.15)' : 'rgba(255,255,255,0.03)', borderColor: newEmp.payType === 'cash_only' ? 'rgba(80,220,140,0.4)' : 'rgba(255,255,255,0.08)' }}>
                    💵 Cash Only
                  </button>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 10, color: 'rgba(255,255,255,0.25)', lineHeight: 1.5 }}>
                  {newEmp.payType === 'bank_cash' ? 'First 67 hours = Bank Transfer, remaining hours = Cash' : 'All hours paid in cash (off-hours rate)'}
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 4 }}>
                <div style={{ opacity: newEmp.payType === 'cash_only' ? 0.4 : 1, transition: 'opacity 0.2s' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>ON-HOUR RATE (£) {newEmp.payType === 'cash_only' && <span style={{ color: 'rgba(255,255,255,0.2)' }}>N/A</span>}</div>
                  <input type="number" step="0.01" placeholder="12.21" value={newEmp.onHourRate} onChange={e => setNewEmp(p => ({ ...p, onHourRate: e.target.value }))} disabled={newEmp.payType === 'cash_only'} style={{ ...G.inp, width: '100%', boxSizing: 'border-box', cursor: newEmp.payType === 'cash_only' ? 'not-allowed' : 'text' }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>{newEmp.payType === 'cash_only' ? 'HOURLY RATE (£)' : 'OFF-HOUR RATE (£)'}</div>
                  <input type="number" step="0.01" placeholder="12.21" value={newEmp.offHourRate} onChange={e => setNewEmp(p => ({ ...p, offHourRate: e.target.value }))} style={{ ...G.inp, width: '100%', boxSizing: 'border-box' }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                <button onClick={addEmployee} style={{ ...G.btn, flex: 1, padding: 14, color: G.acc, fontFamily: FONT, fontWeight: 700, fontSize: 14 }}>Add Employee</button>
                <button onClick={() => { setShowAddEmployee(false); setNewEmp({ name: '', department: '', pin: '', payType: 'bank_cash', onHourRate: '12.21', offHourRate: '12.21' }); }} style={{ ...G.btn, flex: 1, padding: 14, color: 'rgba(255,255,255,0.4)', fontFamily: FONT, fontSize: 14 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Employee Modal */}
      {showEditEmployee && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ ...G.panel, padding: 32, width: 440, maxHeight: '90vh', overflow: 'auto', animation: 'slideIn 0.3s ease' }}>
            <h3 style={{ margin: '0 0 24px', color: '#fff', fontSize: 18, fontWeight: 600 }}>✏️ Edit Employee</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              
              {/* Basic Info */}
              <div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>FULL NAME</div>
                <input value={showEditEmployee.name} onChange={e => setShowEditEmployee(p => ({ ...p, name: e.target.value }))} style={{ ...G.inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>DEPARTMENT</div>
                  <input value={showEditEmployee.department} onChange={e => setShowEditEmployee(p => ({ ...p, department: e.target.value }))} style={{ ...G.inp, width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>4-DIGIT PIN</div>
                  <input type="text" maxLength={4} value={showEditEmployee.pin} onChange={e => setShowEditEmployee(p => ({ ...p, pin: e.target.value.replace(/\D/g, '') }))} style={{ ...G.inp, width: '100%', boxSizing: 'border-box', letterSpacing: 4, textAlign: 'center' }} />
                </div>
              </div>

              {/* Payment Type */}
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 10, fontWeight: 600 }}>PAYMENT TYPE</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setShowEditEmployee(p => ({ ...p, payType: 'bank_cash' }))} 
                    style={{ ...G.btn, flex: 1, padding: '14px 12px', fontFamily: FONT, fontSize: 11, fontWeight: 600, color: showEditEmployee.payType === 'bank_cash' ? '#fff' : 'rgba(255,255,255,0.4)', background: showEditEmployee.payType === 'bank_cash' ? 'rgba(120,200,255,0.15)' : 'rgba(255,255,255,0.03)', borderColor: showEditEmployee.payType === 'bank_cash' ? 'rgba(120,200,255,0.4)' : 'rgba(255,255,255,0.08)' }}>
                    🏦 Bank + Cash
                  </button>
                  <button onClick={() => setShowEditEmployee(p => ({ ...p, payType: 'cash_only' }))} 
                    style={{ ...G.btn, flex: 1, padding: '14px 12px', fontFamily: FONT, fontSize: 11, fontWeight: 600, color: showEditEmployee.payType === 'cash_only' ? '#fff' : 'rgba(255,255,255,0.4)', background: showEditEmployee.payType === 'cash_only' ? 'rgba(80,220,140,0.15)' : 'rgba(255,255,255,0.03)', borderColor: showEditEmployee.payType === 'cash_only' ? 'rgba(80,220,140,0.4)' : 'rgba(255,255,255,0.08)' }}>
                    💵 Cash Only
                  </button>
                </div>
              </div>

              {/* Pay Rates */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ opacity: showEditEmployee.payType === 'cash_only' ? 0.4 : 1, transition: 'opacity 0.2s' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>ON-HOUR RATE (£) {showEditEmployee.payType === 'cash_only' && <span style={{ color: 'rgba(255,255,255,0.2)' }}>N/A</span>}</div>
                  <input type="number" step="0.01" value={showEditEmployee.onHourRate || 12.21} onChange={e => setShowEditEmployee(p => ({ ...p, onHourRate: parseFloat(e.target.value) || 12.21 }))} disabled={showEditEmployee.payType === 'cash_only'} style={{ ...G.inp, width: '100%', boxSizing: 'border-box', cursor: showEditEmployee.payType === 'cash_only' ? 'not-allowed' : 'text' }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>{showEditEmployee.payType === 'cash_only' ? 'HOURLY RATE (£)' : 'OFF-HOUR RATE (£)'}</div>
                  <input type="number" step="0.01" value={showEditEmployee.offHourRate || 12.21} onChange={e => setShowEditEmployee(p => ({ ...p, offHourRate: parseFloat(e.target.value) || 12.21 }))} style={{ ...G.inp, width: '100%', boxSizing: 'border-box' }} />
                </div>
              </div>

              <p style={{ margin: 0, fontSize: 10, color: 'rgba(255,180,50,0.5)' }}>⚠ Rate changes apply to future salary calculations only.</p>

              <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                <button onClick={() => { 
                  if (!showEditEmployee.name || !showEditEmployee.pin || showEditEmployee.pin.length !== 4) {
                    notify('Name and 4-digit PIN are required', 'error');
                    return;
                  }
                  // Check PIN uniqueness (excluding current employee)
                  if (employees.some(e => e.id !== showEditEmployee.id && e.pin === showEditEmployee.pin)) {
                    notify('PIN already in use by another employee', 'error');
                    return;
                  }
                  // Update employee in Supabase
                  const updateEmp = async () => {
                    const { error } = await supabase
                      .from('yss_employees')
                      .update({
                        name: showEditEmployee.name,
                        department: showEditEmployee.department,
                        pin: showEditEmployee.pin,
                        pay_type: showEditEmployee.payType,
                        on_hour_rate: showEditEmployee.onHourRate,
                        off_hour_rate: showEditEmployee.offHourRate
                      })
                      .eq('id', showEditEmployee.id);
                    
                    if (error) { notify('Failed to update employee', 'error'); console.error(error); return; }
                    
                    // Update employee name in records
                    await supabase
                      .from('yss_records')
                      .update({ employee_name: showEditEmployee.name })
                      .eq('employee_id', showEditEmployee.id);
                    
                    notify('Employee updated!');
                    setShowEditEmployee(null);
                    loadData();
                  };
                  updateEmp();
                }} style={{ ...G.btn, flex: 1, padding: 14, color: G.acc, fontFamily: FONT, fontWeight: 700, fontSize: 14 }}>Save Changes</button>
                <button onClick={() => setShowEditEmployee(null)} style={{ ...G.btn, flex: 1, padding: 14, color: 'rgba(255,255,255,0.4)', fontFamily: FONT, fontSize: 14 }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pay Modal */}
      {showPayModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ ...G.panel, padding: 28, width: 360, animation: 'slideIn 0.3s ease' }}>
            <h3 style={{ margin: '0 0 20px', color: '#fff', fontSize: 16, fontWeight: 600 }}>💷 Record Payment</h3>
            <div style={{ marginBottom: 16, padding: '12px 16px', ...G.card, borderColor: 'rgba(180,140,255,0.2)', background: 'rgba(180,140,255,0.04)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{showPayModal.emp.name}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{months[showPayModal.month]} {showPayModal.year}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div style={{ padding: '10px 14px', ...G.card, textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, marginBottom: 4 }}>NET PAY</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: G.prp }}>{formatCurrency(showPayModal.netPay)}</div>
              </div>
              <div style={{ padding: '10px 14px', ...G.card, textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, marginBottom: 4 }}>ALREADY PAID</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: showPayModal.currentPaid > 0 ? G.grn : 'rgba(255,255,255,0.3)' }}>{formatCurrency(showPayModal.currentPaid)}</div>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>TOTAL AMOUNT PAID (£)</div>
              <input 
                type="number" 
                step="0.01" 
                placeholder="0.00"
                defaultValue={showPayModal.currentPaid || ''}
                id="payAmountInput"
                style={{ ...G.inp, width: '100%', boxSizing: 'border-box', fontSize: 18, textAlign: 'center', fontWeight: 600 }} 
              />
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 6 }}>Enter the total cumulative amount paid to this employee for this month</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={async () => {
                const input = document.getElementById('payAmountInput');
                const amount = Math.round((parseFloat(input.value) || 0) * 100) / 100;
                
                // Check if payment exists for this employee/month/year
                const { data: existing } = await supabase
                  .from('yss_payments')
                  .select('id')
                  .eq('employee_id', showPayModal.emp.id)
                  .eq('month', showPayModal.month)
                  .eq('year', showPayModal.year)
                  .single();

                if (existing) {
                  await supabase
                    .from('yss_payments')
                    .update({ amount, updated_at: new Date().toISOString() })
                    .eq('id', existing.id);
                } else {
                  await supabase.from('yss_payments').insert([{
                    employee_id: showPayModal.emp.id,
                    month: showPayModal.month,
                    year: showPayModal.year,
                    amount
                  }]);
                }
                
                notify(`Payment recorded: ${formatCurrency(amount)} for ${showPayModal.emp.name}`);
                setShowPayModal(null);
                loadData();
              }} style={{ ...G.btn, flex: 1, padding: 12, color: G.grn, fontFamily: FONT, fontWeight: 700, fontSize: 13 }}>Save Payment</button>
              <button onClick={() => setShowPayModal(null)} style={{ ...G.btn, flex: 1, padding: 12, color: 'rgba(255,255,255,0.4)', fontFamily: FONT, fontSize: 13 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Paid History Modal */}
      {showPaidHistory && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ ...G.panel, padding: 28, width: 400, maxHeight: '80vh', overflow: 'auto', animation: 'slideIn 0.3s ease' }}>
            <h3 style={{ margin: '0 0 20px', color: '#fff', fontSize: 16, fontWeight: 600 }}>💷 Paid Till Date</h3>
            <div style={{ marginBottom: 20, padding: '16px 20px', ...G.card, borderColor: 'rgba(180,140,255,0.2)', background: 'rgba(180,140,255,0.04)', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{showPaidHistory.name}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{showPaidHistory.department}</div>
              <div style={{ marginTop: 12, fontSize: 28, fontWeight: 700, color: G.grn }}>{formatCurrency(getEmployeePaidTotal(showPaidHistory.id))}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: 1, marginTop: 4 }}>TOTAL PAID</div>
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 1.5, marginBottom: 10, fontWeight: 600 }}>PAYMENT HISTORY BY MONTH</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {getEmployeePaidHistory(showPaidHistory.id).length === 0 ? (
                <div style={{ ...G.card, padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.2)', borderStyle: 'dashed' }}>No payments recorded</div>
              ) : getEmployeePaidHistory(showPaidHistory.id).map((p, i) => (
                <div key={i} style={{ ...G.card, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{p.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: G.grn }}>{formatCurrency(p.amount)}</div>
                </div>
              ))}
            </div>
            <button onClick={() => setShowPaidHistory(null)} style={{ ...G.btn, width: '100%', marginTop: 20, padding: 12, color: 'rgba(255,255,255,0.5)', fontFamily: FONT, fontSize: 13 }}>Close</button>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ ...G.panel, padding: 28, width: 420, maxHeight: '85vh', overflow: 'auto', animation: 'slideIn 0.3s ease' }}>
            <h3 style={{ margin: '0 0 24px', color: '#fff', fontSize: 16, fontWeight: 600 }}>📥 Export Data (CSV)</h3>
            
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 1.5, marginBottom: 12, fontWeight: 600 }}>ATTENDANCE RECORDS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {availableMonths.map((am, i) => (
                  <button key={i} onClick={() => exportAttendance(am.month, am.year)} style={{ ...G.btn, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: FONT }}>
                    <span style={{ fontSize: 13, color: '#fff' }}>{am.label}</span>
                    <span style={{ fontSize: 11, color: G.acc }}>📋 Export</span>
                  </button>
                ))}
                <button onClick={exportAllAttendance} style={{ ...G.btn, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: FONT, borderColor: 'rgba(120,200,255,0.3)', background: 'rgba(120,200,255,0.08)' }}>
                  <span style={{ fontSize: 13, color: G.acc, fontWeight: 600 }}>All Records (Last 6 Months)</span>
                  <span style={{ fontSize: 11, color: G.acc }}>📋 Export</span>
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 1.5, marginBottom: 12, fontWeight: 600 }}>SALARY DATA</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {availableMonths.map((am, i) => (
                  <button key={i} onClick={() => exportSalary(am.month, am.year)} style={{ ...G.btn, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: FONT }}>
                    <span style={{ fontSize: 13, color: '#fff' }}>{am.label}</span>
                    <span style={{ fontSize: 11, color: G.grn }}>💷 Export</span>
                  </button>
                ))}
              </div>
            </div>

            <button onClick={() => setShowExport(false)} style={{ ...G.btn, width: '100%', padding: 12, color: 'rgba(255,255,255,0.5)', fontFamily: FONT, fontSize: 13 }}>Close</button>
          </div>
        </div>
      )}

      {/* Edit Record Modal */}
      {showEditRecord && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ ...G.panel, padding: 28, width: 400, animation: 'slideIn 0.3s ease' }}>
            <h3 style={{ margin: '0 0 20px', color: '#fff', fontSize: 16, fontWeight: 600 }}>✏️ Edit Attendance Record</h3>
            <div style={{ marginBottom: 16, padding: '12px 16px', ...G.card, borderColor: 'rgba(120,200,255,0.2)', background: 'rgba(120,200,255,0.04)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{showEditRecord.record.employeeName}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>Record ID: {showEditRecord.record.id.slice(-8)}</div>
            </div>
            
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>DATE</div>
              <input 
                type="date" 
                value={showEditRecord.editDate} 
                onChange={e => setShowEditRecord(p => ({ ...p, editDate: e.target.value }))}
                style={{ ...G.inp, width: '100%', boxSizing: 'border-box', colorScheme: 'dark' }} 
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>CLOCK IN (GMT)</div>
                <input 
                  type="time" 
                  value={showEditRecord.editClockIn} 
                  onChange={e => setShowEditRecord(p => ({ ...p, editClockIn: e.target.value }))}
                  style={{ ...G.inp, width: '100%', boxSizing: 'border-box', colorScheme: 'dark' }} 
                />
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>CLOCK OUT (GMT)</div>
                <input 
                  type="time" 
                  value={showEditRecord.editClockOut} 
                  onChange={e => setShowEditRecord(p => ({ ...p, editClockOut: e.target.value }))}
                  style={{ ...G.inp, width: '100%', boxSizing: 'border-box', colorScheme: 'dark' }} 
                />
              </div>
            </div>

            {showEditRecord.editDate && showEditRecord.editClockIn && showEditRecord.editClockOut && (
              <div style={{ ...G.card, padding: '10px 14px', marginBottom: 16, textAlign: 'center', borderColor: 'rgba(120,200,255,0.2)', background: 'rgba(120,200,255,0.05)' }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                  {showEditRecord.editClockIn} → {showEditRecord.editClockOut}
                  {new Date(`2000-01-01T${showEditRecord.editClockOut}:00`) > new Date(`2000-01-01T${showEditRecord.editClockIn}:00`) && (
                    <span style={{ color: G.acc, fontWeight: 600 }}> = {fmtHours(calcHours(`2000-01-01T${showEditRecord.editClockIn}:00`, `2000-01-01T${showEditRecord.editClockOut}:00`))}</span>
                  )}
                </span>
              </div>
            )}

            <p style={{ margin: '0 0 16px', fontSize: 10, color: 'rgba(255,180,50,0.5)' }}>⚠ All times are in GMT (London time)</p>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={async () => {
                const success = await updateRecord(
                  showEditRecord.record.id,
                  showEditRecord.editDate,
                  showEditRecord.editClockIn,
                  showEditRecord.editClockOut
                );
                if (success) setShowEditRecord(null);
              }} style={{ ...G.btn, flex: 1, padding: 12, color: G.acc, fontFamily: FONT, fontWeight: 700, fontSize: 13 }}>Save Changes</button>
              <button onClick={() => setShowEditRecord(null)} style={{ ...G.btn, flex: 1, padding: 12, color: 'rgba(255,255,255,0.4)', fontFamily: FONT, fontSize: 13 }}>Cancel</button>
            </div>
            
            <button onClick={() => { deleteRecord(showEditRecord.record.id); setShowEditRecord(null); }} style={{ ...G.btn, width: '100%', marginTop: 12, padding: 12, color: G.red, fontFamily: FONT, fontSize: 12, borderColor: 'rgba(255,90,90,0.2)' }}>🗑 Delete Record</button>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={{ position: 'relative', zIndex: 10, padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ background: 'linear-gradient(135deg, rgba(120,200,255,0.2), rgba(180,120,255,0.2))', borderRadius: 12, padding: '6px 10px', fontSize: 22, border: '1px solid rgba(255,255,255,0.1)' }}>⏱</span>
            <span style={{ background: 'linear-gradient(135deg, #fff, rgba(120,200,255,0.9))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>YSS Attendance</span>
          </h1>
          <p style={{ margin: '4px 0 0 52px', fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: 2.5 }}>ADMIN DASHBOARD • GMT</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setShowExport(true)} style={{ ...G.btn, padding: '12px 22px', color: G.grn, fontFamily: FONT, fontWeight: 600, fontSize: 13 }}>📥 Export</button>
          <button onClick={() => setShowAI(true)} style={{ ...G.btn, padding: '12px 22px', color: G.acc, fontFamily: FONT, fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>✦ AI</button>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>🛡️ Admin</span>
          <button onClick={() => { setRole(null); setView('overview'); setSelectedEmployee(null); setClockEmployee(null); setClockPin(''); setOverrideEmp(null); }} style={{ ...G.btn, padding: '10px 18px', color: G.red, fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>Logout</button>
        </div>
      </header>

      {/* Nav */}
      <nav style={{ position: 'relative', zIndex: 10, display: 'flex', gap: 6, padding: '12px 28px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        {[{ id: 'overview', label: 'Overview', icon: '📊' }, { id: 'employees', label: 'Employees', icon: '👥' }, { id: 'records', label: 'All Records', icon: '📋' }, { id: 'salary', label: 'Salary', icon: '💷' }, { id: 'working', label: 'Currently Working', icon: '🟢' }, { id: 'override', label: 'Clock Override', icon: '🔓' }].map(tab => (
          <button key={tab.id} onClick={() => { setView(tab.id); setSelectedEmployee(null); setOverrideEmp(null); }} style={{ ...G.btn, flex: 1, padding: '14px 16px', fontFamily: FONT, fontWeight: 600, fontSize: 13, color: view === tab.id ? '#fff' : 'rgba(255,255,255,0.4)', background: view === tab.id ? 'rgba(120,200,255,0.12)' : 'rgba(255,255,255,0.03)', borderColor: view === tab.id ? 'rgba(120,200,255,0.25)' : 'rgba(255,255,255,0.06)' }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      <main style={{ position: 'relative', zIndex: 10, padding: 28, maxWidth: 1000, margin: '0 auto' }}>

        {/* ═══ OVERVIEW ═══ */}
        {view === 'overview' && (
          <div>
            {/* Live Clock */}
            <div style={{ ...G.panel, padding: '32px 40px', marginBottom: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 52, fontWeight: 200, color: '#fff', letterSpacing: 4, textShadow: '0 0 40px rgba(120,200,255,0.2)' }}>{currentTime.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Europe/London' })}</div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginTop: 8, letterSpacing: 2 }}>{formatDate(currentTime)} • <span style={{ color: G.acc }}>GMT</span></div>
            </div>

            {/* Stats Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
              <div style={{ ...G.panel, padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 8 }}>TOTAL STAFF</div>
                <div style={{ fontSize: 36, fontWeight: 200, color: G.acc }}>{employees.length}</div>
              </div>
              <div style={{ ...G.panel, padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 8 }}>ACTIVE NOW</div>
                <div style={{ fontSize: 36, fontWeight: 200, color: G.grn }}>{employees.filter(e => isClockedIn(e.id)).length}</div>
              </div>
              <div style={{ ...G.panel, padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 8 }}>THIS MONTH</div>
                <div style={{ fontSize: 36, fontWeight: 200, color: G.prp }}>{fmtHours(employees.reduce((t, e) => t + getMonthlyHours(e.id, getGMTMonth(new Date()), getGMTYear(new Date())), 0))}</div>
              </div>
              <div style={{ ...G.panel, padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 8 }}>RECORDS</div>
                <div style={{ fontSize: 36, fontWeight: 200, color: 'rgba(255,210,80,0.9)' }}>{records.length}</div>
              </div>
            </div>

            {/* Staff Summary Table */}
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: 2.5, marginBottom: 14, fontWeight: 600 }}>STAFF SUMMARY — {months[getGMTMonth(new Date())].toUpperCase()} {getGMTYear(new Date())}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {employees.length === 0 ? (
                <div style={{ ...G.panel, padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.2)', borderStyle: 'dashed' }}>No employees added yet</div>
              ) : employees.map(emp => {
                const hrs = getMonthlyHours(emp.id, getGMTMonth(new Date()), getGMTYear(new Date()));
                const days = getDaysWorked(emp.id, getGMTMonth(new Date()), getGMTYear(new Date()));
                const active = isClockedIn(emp.id);
                return (
                  <div key={emp.id} style={{ ...G.card, padding: '16px 20px', display: 'grid', gridTemplateColumns: '1.5fr 0.8fr 0.8fr 0.8fr', gap: 16, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{emp.name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{emp.department}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>HOURS</div>
                      <div style={{ fontWeight: 700, color: G.acc }}>{fmtHours(hrs)}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>DAYS</div>
                      <div style={{ fontWeight: 700, color: G.prp }}>{days}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      {active ? <span style={{ ...G.card, padding: '4px 12px', fontSize: 10, fontWeight: 700, color: G.grn, borderColor: 'rgba(80,220,140,0.3)', background: 'rgba(80,220,140,0.1)', display: 'inline-block', animation: 'pulse 2s infinite' }}>● ACTIVE</span>
                        : <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>Offline</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ SALARY ═══ */}
        {view === 'salary' && (() => {
          const salaryData = employees.map(emp => ({
            ...emp,
            salary: calculateSalary(emp, salaryMonth.month, salaryMonth.year)
          }));
          const totals = salaryData.reduce((acc, e) => ({
            totalHours: acc.totalHours + e.salary.totalHours,
            onHours: acc.onHours + e.salary.onHours,
            offHours: acc.offHours + e.salary.offHours,
            bankPay: acc.bankPay + e.salary.bankPay,
            cashPay: acc.cashPay + e.salary.cashPay,
            totalPay: acc.totalPay + e.salary.totalPay
          }), { totalHours: 0, onHours: 0, offHours: 0, bankPay: 0, cashPay: 0, totalPay: 0 });

          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h2 style={{ margin: 0, fontSize: 13, letterSpacing: 3, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>💷 SALARY CALCULATOR</h2>
                <select value={`${salaryMonth.month}-${salaryMonth.year}`} onChange={e => { const [m, y] = e.target.value.split('-'); setSalaryMonth({ month: Number(m), year: Number(y) }); }}
                  style={{ ...G.inp, minWidth: 180, borderRadius: 12, cursor: 'pointer', appearance: 'auto', padding: '10px 14px' }}>
                  {availableMonths.map((am, i) => <option key={i} value={`${am.month}-${am.year}`}>{am.label}</option>)}
                </select>
              </div>

              {/* Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
                <div style={{ ...G.panel, padding: 20, textAlign: 'center', borderColor: 'rgba(120,200,255,0.2)', background: 'rgba(120,200,255,0.04)' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 8 }}>TOTAL BANK PAY</div>
                  <div style={{ fontSize: 28, fontWeight: 600, color: G.acc }}>{formatCurrency(totals.bankPay)}</div>
                </div>
                <div style={{ ...G.panel, padding: 20, textAlign: 'center', borderColor: 'rgba(80,220,140,0.2)', background: 'rgba(80,220,140,0.04)' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 8 }}>TOTAL CASH PAY</div>
                  <div style={{ fontSize: 28, fontWeight: 600, color: G.grn }}>{formatCurrency(totals.cashPay)}</div>
                </div>
                <div style={{ ...G.panel, padding: 20, textAlign: 'center', borderColor: 'rgba(180,140,255,0.2)', background: 'rgba(180,140,255,0.04)' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 8 }}>GRAND TOTAL</div>
                  <div style={{ fontSize: 28, fontWeight: 600, color: G.prp }}>{formatCurrency(totals.totalPay)}</div>
                </div>
              </div>

              {/* Salary Table Header */}
              <div style={{ ...G.card, padding: '12px 16px', marginBottom: 8, display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.6fr 0.5fr 0.7fr 0.7fr 0.8fr 0.8fr 0.7fr', gap: 8, alignItems: 'center', background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 1 }}>NAME</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textAlign: 'center' }}>HOURS</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textAlign: 'center' }}>ON HRS</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textAlign: 'center' }}>RATE</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textAlign: 'center' }}>BANK</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textAlign: 'center' }}>CASH</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textAlign: 'center' }}>NET PAY</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textAlign: 'center' }}>PAID</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textAlign: 'center' }}>PENDING</div>
              </div>

              {/* Salary Rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {salaryData.length === 0 ? (
                  <div style={{ ...G.panel, padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.2)', borderStyle: 'dashed' }}>No employees</div>
                ) : salaryData.map(emp => {
                  const s = emp.salary;
                  const payKey = `${emp.id}-${salaryMonth.month}-${salaryMonth.year}`;
                  const paidAmount = payments[payKey] || 0;
                  const pending = Math.max(0, s.totalPay - paidAmount);
                  return (
                    <div key={emp.id} style={{ ...G.card, padding: '12px 16px', display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.6fr 0.5fr 0.7fr 0.7fr 0.8fr 0.8fr 0.7fr', gap: 8, alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{emp.name}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{emp.department}</span>
                          <span style={{ ...G.card, padding: '1px 5px', fontSize: 7, fontWeight: 700, color: s.payType === 'bank_cash' ? G.acc : G.grn, borderColor: s.payType === 'bank_cash' ? 'rgba(120,200,255,0.2)' : 'rgba(80,220,140,0.2)', background: s.payType === 'bank_cash' ? 'rgba(120,200,255,0.06)' : 'rgba(80,220,140,0.06)', borderRadius: 4 }}>
                            {s.payType === 'bank_cash' ? '🏦' : '💵'}
                          </span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: '#fff' }}>{s.totalHours.toFixed(2)}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        {s.payType === 'bank_cash' ? (
                          <>
                            <div style={{ fontWeight: 600, fontSize: 11, color: s.onHours > 0 ? G.acc : 'rgba(255,255,255,0.2)' }}>{s.onHours.toFixed(2)}</div>
                            {s.offHours > 0 && <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>+{s.offHours.toFixed(2)}</div>}
                          </>
                        ) : (
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>N/A</div>
                        )}
                      </div>
                      <div style={{ textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>£{s.payType === 'cash_only' ? s.offRate.toFixed(2) : s.onRate.toFixed(2)}</div>
                      <div style={{ textAlign: 'center' }}>
                        {s.payType === 'bank_cash' ? (
                          <div style={{ fontWeight: 600, fontSize: 11, color: s.bankPay > 0 ? G.acc : 'rgba(255,255,255,0.15)' }}>{formatCurrency(s.bankPay)}</div>
                        ) : (
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>N/A</div>
                        )}
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 11, color: s.cashPay > 0 ? G.grn : 'rgba(255,255,255,0.15)' }}>{formatCurrency(s.cashPay)}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 700, fontSize: 12, color: G.prp }}>{formatCurrency(s.totalPay)}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 11, color: paidAmount > 0 ? G.grn : 'rgba(255,255,255,0.2)' }}>{formatCurrency(paidAmount)}</div>
                        <button onClick={() => setShowPayModal({ emp, month: salaryMonth.month, year: salaryMonth.year, netPay: s.totalPay, currentPaid: paidAmount })} style={{ background: 'none', border: 'none', fontSize: 8, color: G.acc, cursor: 'pointer', fontFamily: FONT, padding: '2px 0', textDecoration: 'underline' }}>Pay</button>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 11, color: pending > 0 ? G.red : 'rgba(80,220,140,0.6)' }}>{pending > 0 ? formatCurrency(pending) : '✓'}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Totals Row */}
              {salaryData.length > 0 && (() => {
                const totalPaid = salaryData.reduce((sum, emp) => sum + (payments[`${emp.id}-${salaryMonth.month}-${salaryMonth.year}`] || 0), 0);
                const totalPending = Math.max(0, totals.totalPay - totalPaid);
                return (
                  <div style={{ ...G.panel, padding: '14px 16px', marginTop: 12, display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.6fr 0.5fr 0.7fr 0.7fr 0.8fr 0.8fr 0.7fr', gap: 8, alignItems: 'center', borderColor: 'rgba(180,140,255,0.25)', background: 'rgba(180,140,255,0.04)' }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: G.prp }}>TOTAL</div>
                    <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 12, color: '#fff' }}>{totals.totalHours.toFixed(2)}</div>
                    <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 11, color: G.acc }}>{totals.onHours.toFixed(2)}</div>
                    <div></div>
                    <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 11, color: G.acc }}>{formatCurrency(totals.bankPay)}</div>
                    <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 11, color: G.grn }}>{formatCurrency(totals.cashPay)}</div>
                    <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, color: G.prp }}>{formatCurrency(totals.totalPay)}</div>
                    <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 11, color: totalPaid > 0 ? G.grn : 'rgba(255,255,255,0.3)' }}>{formatCurrency(totalPaid)}</div>
                    <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 11, color: totalPending > 0 ? G.red : G.grn }}>{totalPending > 0 ? formatCurrency(totalPending) : '✓'}</div>
                  </div>
                );
              })()}

              <div style={{ marginTop: 20, padding: '16px 20px', ...G.card, borderColor: 'rgba(255,180,50,0.15)', background: 'rgba(255,180,50,0.03)' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,180,50,0.6)', marginBottom: 6, fontWeight: 600 }}>ℹ️ SALARY CALCULATION RULES</div>
                <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 10, color: 'rgba(255,255,255,0.3)', lineHeight: 1.8 }}>
                  <li><strong style={{ color: 'rgba(120,200,255,0.8)' }}>Bank + Cash:</strong> First 67 hours at on-hour rate → Bank Transfer. Hours beyond 67 at off-hour rate → Cash.</li>
                  <li><strong style={{ color: 'rgba(80,220,140,0.8)' }}>Cash Only:</strong> All hours at off-hour rate → Cash payment.</li>
                  <li>Salary auto-generates on the 1st of each month for the previous month.</li>
                </ul>
              </div>
            </div>
          );
        })()}

        {/* ═══ CURRENTLY WORKING ═══ */}
        {view === 'working' && (() => {
          const todayStr = getGMTDateStr(new Date());
          const activeRecs = records.filter(r => r.clockIn && !r.clockOut);
          const todayCompleted = records.filter(r => r.date === todayStr && r.clockOut);
          return (
            <div>
              <div style={{ ...G.panel, padding: '32px 40px', marginBottom: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 42, fontWeight: 200, color: '#fff', letterSpacing: 4, textShadow: '0 0 40px rgba(120,200,255,0.2)' }}>{currentTime.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Europe/London' })}</div>
                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginTop: 8, letterSpacing: 2 }}>{formatDate(currentTime)} • <span style={{ color: G.acc }}>GMT</span></div>
              </div>

              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: 2.5, marginBottom: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: G.grn, animation: 'pulse 2s infinite' }}></span>
                CURRENTLY CLOCKED IN ({activeRecs.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
                {activeRecs.length === 0 ? (
                  <div style={{ ...G.panel, padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.2)', borderStyle: 'dashed' }}>No one is currently clocked in</div>
                ) : activeRecs.map(rec => {
                  const elapsed = calcHours(rec.clockIn, currentTime.toISOString());
                  return (
                    <div key={rec.id} style={{ ...G.card, padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: 'rgba(80,220,140,0.25)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: G.grn, animation: 'pulse 2s infinite', flexShrink: 0 }}></div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>{rec.employeeName}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>Clocked in at {formatTime(rec.clockIn)}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>ELAPSED</div>
                        <div style={{ fontWeight: 700, fontSize: 18, color: G.acc }}>{fmtHours(elapsed)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: 2.5, marginBottom: 14, fontWeight: 600 }}>COMPLETED TODAY ({todayCompleted.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {todayCompleted.length === 0 ? (
                  <div style={{ ...G.panel, padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.2)', borderStyle: 'dashed' }}>No completed shifts today</div>
                ) : todayCompleted.map(rec => {
                  const hrs = calcHours(rec.clockIn, rec.clockOut);
                  const sl = shiftLabel(rec);
                  return (
                    <div key={rec.id} style={{ ...G.card, padding: '16px 20px', display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 0.8fr', gap: 14, alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{rec.employeeName}</div>
                        {sl && <div style={{ ...G.card, display: 'inline-block', padding: '2px 8px', fontSize: 9, fontWeight: 700, color: 'rgba(255,180,50,0.9)', borderColor: 'rgba(255,180,50,0.25)', background: 'rgba(255,180,50,0.08)', marginTop: 3 }}>⚡ {sl.toUpperCase()}</div>}
                      </div>
                      <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>IN</div><div style={{ color: G.grn, fontSize: 13 }}>{formatTime(rec.clockIn)}</div></div>
                      <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>OUT</div><div style={{ color: G.red, fontSize: 13 }}>{formatTime(rec.clockOut)}</div></div>
                      <div style={{ textAlign: 'right' }}><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>HOURS</div><div style={{ fontWeight: 700, color: G.acc }}>{fmtHours(hrs)}</div></div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ═══ ADMIN CLOCK OVERRIDE ═══ */}
        {view === 'override' && (
          <div>
            <div style={{ ...G.panel, padding: '28px 36px', marginBottom: 28, borderColor: 'rgba(255,180,50,0.2)', background: 'rgba(255,180,50,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>🔓</span>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>Admin Clock Override</h2>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 }}>Use this to manually clock in or out an employee when they cannot do it themselves (GPS issue, forgot to clock, etc.). This bypasses GPS verification.</p>
            </div>

            {!overrideEmp ? (
              <div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: 2.5, marginBottom: 14, fontWeight: 600 }}>SELECT EMPLOYEE</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {employees.length === 0 ? (
                    <div style={{ ...G.panel, padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.2)', borderStyle: 'dashed' }}>No employees added yet</div>
                  ) : employees.map(emp => {
                    const active = isClockedIn(emp.id);
                    return (
                      <button key={emp.id} onClick={() => setOverrideEmp(emp)}
                        onMouseEnter={() => setHovered('ov-' + emp.id)} onMouseLeave={() => setHovered(null)}
                        style={{ ...(hovered === 'ov-' + emp.id ? G.panelH : G.panel), padding: '18px 24px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', fontFamily: FONT, color: '#fff', borderColor: active ? 'rgba(80,220,140,0.25)' : hovered === 'ov-' + emp.id ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)', transition: 'all 0.25s ease' }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 3 }}>{emp.name}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: 1 }}>{emp.department}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          {active ? <span style={{ ...G.card, padding: '4px 14px', fontSize: 10, fontWeight: 700, color: G.grn, borderColor: 'rgba(80,220,140,0.3)', background: 'rgba(80,220,140,0.1)', display: 'inline-block', animation: 'pulse 2s infinite' }}>● ACTIVE</span>
                            : <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>Offline</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ maxWidth: 520, margin: '0 auto', animation: 'slideIn 0.3s ease' }}>
                {/* Live Clock */}
                <div style={{ ...G.panel, padding: '32px 36px', marginBottom: 24, textAlign: 'center' }}>
                  <div style={{ fontSize: 52, fontWeight: 200, color: '#fff', letterSpacing: 4, textShadow: '0 0 40px rgba(120,200,255,0.2)' }}>{currentTime.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Europe/London' })}</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 8, letterSpacing: 2 }}>{formatDate(currentTime)}</div>
                </div>

                <div style={{ ...G.panel, padding: '36px 32px', textAlign: 'center', marginBottom: 20 }}>
                  <div style={{ ...G.card, padding: '6px 14px', display: 'inline-block', marginBottom: 12, borderColor: 'rgba(255,180,50,0.25)', background: 'rgba(255,180,50,0.06)' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,180,50,0.9)', letterSpacing: 2 }}>🔓 ADMIN OVERRIDE</span>
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{overrideEmp.name}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginBottom: 28, letterSpacing: 1 }}>{overrideEmp.department}</div>

                  {isClockedIn(overrideEmp.id) && (() => {
                    const openRec = records.find(r => r.employeeId === overrideEmp.id && r.clockIn && !r.clockOut);
                    return (
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ ...G.card, padding: '10px 18px', display: 'inline-block', borderColor: 'rgba(80,220,140,0.3)', background: 'rgba(80,220,140,0.06)' }}>
                          <span style={{ color: G.grn, fontSize: 12, fontWeight: 600 }}>● Clocked In since {openRec ? formatTime(openRec.clockIn) : ''}</span>
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: 2, marginBottom: 14, fontWeight: 600 }}>CLOCK NOW</div>
                  <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
                    <button onClick={() => { doClockAction('in', overrideEmp, true); setOverrideEmp(null); }} style={{ ...G.btn, padding: '18px 36px', fontFamily: FONT, fontSize: 14, fontWeight: 700, color: '#fff', background: 'rgba(80,220,140,0.15)', borderColor: 'rgba(80,220,140,0.35)', boxShadow: '0 4px 20px rgba(80,220,140,0.15)' }}>CLOCK IN</button>
                    <button onClick={() => { doClockAction('out', overrideEmp, true); setOverrideEmp(null); }} style={{ ...G.btn, padding: '18px 36px', fontFamily: FONT, fontSize: 14, fontWeight: 700, color: '#fff', background: 'rgba(255,90,90,0.15)', borderColor: 'rgba(255,90,90,0.35)', boxShadow: '0 4px 20px rgba(255,90,90,0.15)' }}>CLOCK OUT</button>
                  </div>
                  <div style={{ marginTop: 12, fontSize: 10, color: 'rgba(255,180,50,0.4)', letterSpacing: 1.5 }}>⚠ NO GPS VERIFICATION</div>
                </div>

                {/* Backdated Entry Section */}
                <div style={{ ...G.panel, padding: '28px 32px', borderColor: 'rgba(180,140,255,0.2)', background: 'rgba(180,140,255,0.03)' }}>
                  <div style={{ fontSize: 11, color: 'rgba(180,140,255,0.8)', letterSpacing: 2, marginBottom: 16, fontWeight: 600, textAlign: 'center' }}>📅 ADD BACKDATED ENTRY</div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>DATE</div>
                      <input 
                        type="date" 
                        value={backdatedEntry.date} 
                        onChange={e => setBackdatedEntry(p => ({ ...p, date: e.target.value }))} 
                        max={new Date().toISOString().split('T')[0]}
                        style={{ ...G.inp, width: '100%', boxSizing: 'border-box', colorScheme: 'dark' }} 
                      />
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>CLOCK IN TIME</div>
                        <input 
                          type="time" 
                          value={backdatedEntry.clockIn} 
                          onChange={e => setBackdatedEntry(p => ({ ...p, clockIn: e.target.value }))} 
                          style={{ ...G.inp, width: '100%', boxSizing: 'border-box', colorScheme: 'dark' }} 
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, letterSpacing: 1 }}>CLOCK OUT TIME</div>
                        <input 
                          type="time" 
                          value={backdatedEntry.clockOut} 
                          onChange={e => setBackdatedEntry(p => ({ ...p, clockOut: e.target.value }))} 
                          style={{ ...G.inp, width: '100%', boxSizing: 'border-box', colorScheme: 'dark' }} 
                        />
                      </div>
                    </div>

                    {backdatedEntry.date && backdatedEntry.clockIn && backdatedEntry.clockOut && (
                      <div style={{ ...G.card, padding: '10px 14px', textAlign: 'center', borderColor: 'rgba(180,140,255,0.2)', background: 'rgba(180,140,255,0.05)' }}>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                          {formatDate(backdatedEntry.date + 'T12:00:00Z')} • {backdatedEntry.clockIn} → {backdatedEntry.clockOut}
                          {new Date(`${backdatedEntry.date}T${backdatedEntry.clockOut}:00`) > new Date(`${backdatedEntry.date}T${backdatedEntry.clockIn}:00`) && (
                            <span style={{ color: G.prp, fontWeight: 600 }}> = {fmtHours(calcHours(`${backdatedEntry.date}T${backdatedEntry.clockIn}:00`, `${backdatedEntry.date}T${backdatedEntry.clockOut}:00`))}</span>
                          )}
                        </span>
                      </div>
                    )}

                    <button 
                      onClick={() => createBackdatedEntry(overrideEmp)} 
                      style={{ ...G.btn, padding: '14px 24px', fontFamily: FONT, fontSize: 13, fontWeight: 700, color: G.prp, borderColor: 'rgba(180,140,255,0.3)', marginTop: 4 }}
                    >
                      📅 Add Backdated Entry
                    </button>
                  </div>
                </div>

                <button onClick={() => { setOverrideEmp(null); setBackdatedEntry({ date: '', clockIn: '', clockOut: '' }); }} style={{ marginTop: 20, width: '100%', background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px 24px', color: 'rgba(255,255,255,0.35)', fontFamily: FONT, cursor: 'pointer', fontSize: 12 }}>← Back to employee list</button>
              </div>
            )}
          </div>
        )}

        {/* ═══ EMPLOYEES ═══ */}
        {view === 'employees' && !selectedEmployee && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 13, letterSpacing: 3, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>EMPLOYEE DIRECTORY</h2>
              <button onClick={() => setShowAddEmployee(true)} style={{ ...G.btn, padding: '12px 24px', color: G.acc, fontFamily: FONT, fontWeight: 600, fontSize: 13 }}>+ Add Employee</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {employees.length === 0 ? (
                <div style={{ ...G.panel, padding: 60, textAlign: 'center', color: 'rgba(255,255,255,0.25)', borderStyle: 'dashed' }}><p style={{ fontSize: 16, marginBottom: 8 }}>No employees yet</p><p style={{ fontSize: 12 }}>Click "+ Add Employee" to get started</p></div>
              ) : employees.map(emp => {
                const hrs = getMonthlyHours(emp.id, getGMTMonth(new Date()), getGMTYear(new Date()));
                const active = isClockedIn(emp.id);
                return (
                  <div key={emp.id} onMouseEnter={() => setHovered(emp.id)} onMouseLeave={() => setHovered(null)}
                    style={{ ...(hovered === emp.id ? G.panelH : G.panel), padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: active ? 'rgba(80,220,140,0.3)' : hovered === emp.id ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)', transition: 'all 0.25s ease' }}>
                    <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => setSelectedEmployee(emp)}>
                      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{emp.name}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <span>{emp.department}</span>
                        <span style={{ ...G.card, padding: '2px 8px', fontSize: 10, fontWeight: 600, color: G.prp, borderColor: 'rgba(180,140,255,0.2)', background: 'rgba(180,140,255,0.06)', borderRadius: 6 }}>PIN: {emp.pin}</span>
                        <span style={{ ...G.card, padding: '2px 8px', fontSize: 9, fontWeight: 600, color: emp.payType === 'bank_cash' ? G.acc : G.grn, borderColor: emp.payType === 'bank_cash' ? 'rgba(120,200,255,0.2)' : 'rgba(80,220,140,0.2)', background: emp.payType === 'bank_cash' ? 'rgba(120,200,255,0.06)' : 'rgba(80,220,140,0.06)', borderRadius: 6 }}>{emp.payType === 'bank_cash' ? '🏦 Bank+Cash' : '💵 Cash Only'}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => setSelectedEmployee(emp)}>
                        {active && <div style={{ ...G.card, padding: '4px 14px', display: 'inline-block', marginBottom: 8, borderColor: 'rgba(80,220,140,0.3)', background: 'rgba(80,220,140,0.1)' }}><span style={{ color: G.grn, fontSize: 10, fontWeight: 700, letterSpacing: 1, animation: 'pulse 2s infinite' }}>● ACTIVE</span></div>}
                        <div style={{ fontSize: 22, fontWeight: 700, color: G.acc }}>{fmtHours(hrs)}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: 1 }}>THIS MONTH</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setShowPaidHistory(emp); }} style={{ ...G.btn, padding: '10px 14px', color: G.grn, fontFamily: FONT, fontSize: 11, fontWeight: 600, textAlign: 'center', minWidth: 70 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{formatCurrency(getEmployeePaidTotal(emp.id))}</div>
                        <div style={{ fontSize: 8, opacity: 0.7, marginTop: 2 }}>PAID</div>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setShowEditEmployee({ ...emp }); }} style={{ ...G.btn, padding: '10px 16px', color: 'rgba(255,255,255,0.5)', fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>✏️ Edit</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ EMPLOYEE DETAIL ═══ */}
        {view === 'employees' && selectedEmployee && (
          <div style={{ animation: 'slideIn 0.3s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
              <button onClick={() => setSelectedEmployee(null)} style={{ ...G.btn, padding: '10px 22px', color: 'rgba(255,255,255,0.5)', fontFamily: FONT, fontSize: 13 }}>← Back</button>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setShowEditEmployee({ ...selectedEmployee })} style={{ ...G.btn, padding: '10px 22px', color: G.acc, fontFamily: FONT, fontSize: 13 }}>✏️ Edit</button>
                <button onClick={() => deleteEmployee(selectedEmployee.id, selectedEmployee.name)} style={{ ...G.btn, padding: '10px 22px', color: G.red, fontFamily: FONT, fontSize: 13, borderColor: 'rgba(255,90,90,0.2)' }}>Remove</button>
              </div>
            </div>
            <div style={{ ...G.panel, padding: 28, marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{selectedEmployee.name}</div><div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5 }}>{selectedEmployee.department}</div></div>
                {isClockedIn(selectedEmployee.id) && <div style={{ ...G.card, padding: '8px 18px', borderColor: 'rgba(80,220,140,0.3)', background: 'rgba(80,220,140,0.08)' }}><span style={{ color: G.grn, fontSize: 12, fontWeight: 600 }}>● Clocked In</span></div>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
              <select value={`${selectedMonth}-${selectedYear}`} onChange={e => { const [m, y] = e.target.value.split('-'); setSelectedMonth(Number(m)); setSelectedYear(Number(y)); }}
                style={{ ...G.inp, flex: 1, borderRadius: 14, cursor: 'pointer', appearance: 'auto' }}>
                {availableMonths.map((am, i) => <option key={i} value={`${am.month}-${am.year}`}>{am.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 28 }}>
              <div style={{ ...G.panel, padding: 24, textAlign: 'center', borderColor: 'rgba(120,200,255,0.2)', background: 'rgba(120,200,255,0.06)' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 10 }}>TOTAL HOURS</div>
                <div style={{ fontSize: 40, fontWeight: 200, color: G.acc }}>{fmtHours(getMonthlyHours(selectedEmployee.id, selectedMonth, selectedYear))}</div>
              </div>
              <div style={{ ...G.panel, padding: 24, textAlign: 'center', borderColor: 'rgba(180,120,255,0.2)', background: 'rgba(180,120,255,0.06)' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 10 }}>DAYS WORKED</div>
                <div style={{ fontSize: 40, fontWeight: 200, color: G.prp }}>{getDaysWorked(selectedEmployee.id, selectedMonth, selectedYear)}</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: 2.5, marginBottom: 14, fontWeight: 600 }}>DAILY BREAKDOWN</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {getDailyRecs(selectedEmployee.id, selectedMonth, selectedYear).length === 0 ? (
                <div style={{ ...G.panel, padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.2)', borderStyle: 'dashed' }}>No records for this month</div>
              ) : getDailyRecs(selectedEmployee.id, selectedMonth, selectedYear).map(rec => {
                const hrs = rec.clockOut ? calcHours(rec.clockIn, rec.clockOut) : 0;
                const sl = shiftLabel(rec);
                const isAdmin = rec.createdBy === 'admin';
                return (
                  <div key={rec.id} style={{ ...G.card, padding: '16px 20px', display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.8fr 0.8fr 0.8fr 0.5fr', gap: 12, alignItems: 'center', borderColor: !rec.clockOut ? 'rgba(120,200,255,0.2)' : 'rgba(255,255,255,0.06)' }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 3 }}>DATE</div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{formatDate(rec.date + 'T12:00:00Z')}</div>
                      {sl && <div style={{ ...G.card, display: 'inline-block', padding: '2px 8px', fontSize: 9, fontWeight: 700, color: 'rgba(255,180,50,0.95)', borderColor: 'rgba(255,180,50,0.25)', background: 'rgba(255,180,50,0.1)', marginTop: 4, borderRadius: 8 }}>⚡ {sl.toUpperCase()}</div>}
                    </div>
                    <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 3 }}>IN</div><div style={{ color: G.grn, fontSize: 13 }}>{formatTime(rec.clockIn)}</div></div>
                    <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 3 }}>OUT</div><div style={{ color: rec.clockOut ? G.red : G.acc, fontSize: 13 }}>{rec.clockOut ? formatTime(rec.clockOut) : 'ACTIVE'}</div></div>
                    <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 3 }}>HOURS</div><div style={{ fontWeight: 700, color: G.acc, fontSize: 14 }}>{rec.clockOut ? fmtHours(hrs) : '—'}</div></div>
                    <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 3 }}>BY</div><div style={{ fontSize: 11, fontWeight: 600, color: isAdmin ? 'rgba(255,180,50,0.9)' : G.acc }}>{isAdmin ? '🛡️ Admin' : '👤 Staff'}</div></div>
                    <div style={{ textAlign: 'right' }}>
                      {rec.clockOut && (
                        <button onClick={() => {
                          const clockInDate = new Date(rec.clockIn);
                          const clockOutDate = new Date(rec.clockOut);
                          setShowEditRecord({
                            record: rec,
                            editDate: rec.date,
                            editClockIn: clockInDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }),
                            editClockOut: clockOutDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' })
                          });
                        }} style={{ ...G.btn, padding: '6px 12px', fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: FONT }}>✏️</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ ALL RECORDS ═══ */}
        {view === 'records' && (() => {
          const filtered = [...records].reverse().filter(rec => {
            if (searchName && !rec.employeeName.toLowerCase().includes(searchName.toLowerCase())) return false;
            if (searchMonth !== 'all') {
              const [fm, fy] = searchMonth.split('-').map(Number);
              const parts = rec.date.split('-');
              if (parseInt(parts[1]) - 1 !== fm || parseInt(parts[0]) !== fy) return false;
            }
            return true;
          });
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ margin: 0, fontSize: 13, letterSpacing: 3, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>ALL RECORDS</h2>
                <span style={{ fontSize: 12, color: G.acc }}>{filtered.length} of {records.length} entries</span>
              </div>

              {/* Search Filters */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input value={searchName} onChange={e => setSearchName(e.target.value)} placeholder="Search by employee name..." style={{ ...G.inp, width: '100%', boxSizing: 'border-box', paddingLeft: 40 }} />
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>🔍</span>
                </div>
                <select value={searchMonth} onChange={e => setSearchMonth(e.target.value)} style={{ ...G.inp, minWidth: 180, borderRadius: 12, cursor: 'pointer', appearance: 'auto' }}>
                  <option value="all">All Months</option>
                  {availableMonths.map((am, i) => <option key={i} value={`${am.month}-${am.year}`}>{am.label}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.length === 0 ? (
                  <div style={{ ...G.panel, padding: 60, textAlign: 'center', color: 'rgba(255,255,255,0.2)', borderStyle: 'dashed' }}><p style={{ fontSize: 16, marginBottom: 8 }}>{records.length === 0 ? 'No records yet' : 'No matching records'}</p></div>
                ) : filtered.map(rec => {
                  const hrs = rec.clockOut ? calcHours(rec.clockIn, rec.clockOut) : 0;
                  const sl = shiftLabel(rec);
                  const isAdmin = rec.createdBy === 'admin';
                  return (
                    <div key={rec.id} style={{ ...G.card, padding: '16px 20px', display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 0.8fr 0.8fr 0.5fr', gap: 14, alignItems: 'center', borderColor: !rec.clockOut ? 'rgba(80,220,140,0.2)' : 'rgba(255,255,255,0.06)' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{rec.employeeName}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                          {formatDate(rec.date + 'T12:00:00Z')}
                          {sl && <span style={{ ...G.card, display: 'inline-block', padding: '1px 7px', fontSize: 8, fontWeight: 700, color: 'rgba(255,180,50,0.95)', borderColor: 'rgba(255,180,50,0.25)', background: 'rgba(255,180,50,0.1)', borderRadius: 8 }}>⚡ {sl.toUpperCase()}</span>}
                        </div>
                      </div>
                      <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>IN</div><div style={{ color: G.grn, fontSize: 13 }}>{formatTime(rec.clockIn)}</div></div>
                      <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>OUT</div><div style={{ color: rec.clockOut ? G.red : G.acc, fontSize: 13 }}>{rec.clockOut ? formatTime(rec.clockOut) : 'ACTIVE'}</div></div>
                      <div><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>HOURS</div><div style={{ fontWeight: 700, color: G.acc }}>{rec.clockOut ? fmtHours(hrs) : '—'}</div></div>
                      <div style={{ textAlign: 'center' }}><div style={{ ...G.card, display: 'inline-block', padding: '5px 10px', fontSize: 9, fontWeight: 700, color: isAdmin ? 'rgba(255,180,50,0.9)' : G.acc, borderColor: isAdmin ? 'rgba(255,180,50,0.2)' : 'rgba(120,200,255,0.2)', background: isAdmin ? 'rgba(255,180,50,0.08)' : 'rgba(120,200,255,0.08)' }}>{isAdmin ? '🛡️ Admin' : '👤 Staff'}</div></div>
                      <div style={{ textAlign: 'right' }}>
                        {rec.clockOut && (
                          <button onClick={() => {
                            const clockInDate = new Date(rec.clockIn);
                            const clockOutDate = new Date(rec.clockOut);
                            setShowEditRecord({
                              record: rec,
                              editDate: rec.date,
                              editClockIn: clockInDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }),
                              editClockOut: clockOutDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' })
                            });
                          }} style={{ ...G.btn, padding: '6px 12px', fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: FONT }}>✏️</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </main>

      <footer style={{ position: 'relative', zIndex: 10, padding: 28, textAlign: 'center', color: 'rgba(255,255,255,0.15)', fontSize: 10, letterSpacing: 2.5, borderTop: '1px solid rgba(255,255,255,0.04)', marginTop: 40 }}>
        YSS ATTENDANCE • TAMPER-PROOF CLOCK SYSTEM • POWERED BY AI
      </footer>
    </div>
  );
}
