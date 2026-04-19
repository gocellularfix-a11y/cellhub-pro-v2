import { useState } from 'react';
import type { Employee } from '@/store/types';
import { getLabels } from '@/config/i18n';
import type { Lang } from '@/store/types';
import { comparePin } from '@/utils/pinHash';

interface EmployeeLoginProps {
  employees: Employee[];
  lang: Lang;
  onLogin: (employee: Employee) => void;
}

export default function EmployeeLogin({ employees, lang, onLogin }: EmployeeLoginProps) {
  const L = getLabels(lang);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const activeEmployees = employees.filter((e) => e.active);

  // r27 B3: an employee with an empty stored PIN (e.g. the no-PIN owner
  // fallback created via "Continue as Owner") can clock in directly without
  // entering anything. We auto-detect this when the employee is selected.
  const employeeHasNoPin = !!selectedEmployee && (!selectedEmployee.pin || selectedEmployee.pin === '');

  const handlePinSubmit = () => {
    if (!selectedEmployee) return;
    // r27 B3: hashed compare. Legacy plaintext PINs still work via comparePin
    // until the boot migration in App.tsx hashes them on next launch.
    if (comparePin(pin, selectedEmployee.pin)) {
      onLogin(selectedEmployee);
    } else {
      setError(true);
      setPin('');
    }
  };

  // r27 B3: bypass PIN entry if the employee has no PIN configured
  const handleNoPinLogin = () => {
    if (!selectedEmployee) return;
    if (employeeHasNoPin) onLogin(selectedEmployee);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handlePinSubmit();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-900 p-4">
      <div className="glass-card p-8 w-full max-w-md">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-brand-500 to-accent-500 bg-clip-text text-transparent">
            CellHub Pro
          </h1>
          <p className="text-slate-400 mt-2 text-sm">{L.whoIsWorking}</p>
        </div>

        {!selectedEmployee ? (
          /* Employee selection */
          <div className="space-y-2">
            <p className="text-sm text-slate-400 mb-3">{L.selectEmployee}</p>
            {activeEmployees.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-slate-500">{L.noActiveEmployees}</p>
                <button
                  className="btn btn-primary mt-4"
                  onClick={() => {
                    // r27 B3: Auto-login owner with EMPTY PIN (OPCIÓN A).
                    // The user can set a real PIN later via Settings → Employees.
                    // Empty pin is a valid stored value — comparePin('') returns true
                    // for empty input, and EmployeeLogin auto-bypasses PIN entry when
                    // the selected employee has no PIN.
                    onLogin({
                      id: 'owner',
                      name: 'Owner',
                      role: 'owner',
                      pin: '',
                      commissionRate: 0,
                      active: true,
                      clockLog: [],
                      onboardingSigned: true,
                      startDate: new Date().toISOString(),
                      createdAt: new Date().toISOString(),
                    });
                  }}
                >
                  Continue as Owner
                </button>
              </div>
            ) : (
              activeEmployees.map((emp) => (
                <button
                  key={emp.id}
                  onClick={() => {
                    setSelectedEmployee(emp);
                    setPin('');
                    setError(false);
                  }}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 
                             hover:bg-white/10 border border-white/10 transition-all text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 font-bold">
                    {emp.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-white font-medium">{emp.name}</p>
                    <p className="text-xs text-slate-500 capitalize">{emp.role}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          /* PIN entry */
          <div className="space-y-4">
            <button
              onClick={() => {
                setSelectedEmployee(null);
                setPin('');
                setError(false);
              }}
              className="text-sm text-slate-400 hover:text-white flex items-center gap-1"
            >
              ← {L.backToEmployees}
            </button>

            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 text-2xl font-bold mx-auto mb-3">
                {selectedEmployee.name.charAt(0).toUpperCase()}
              </div>
              <p className="text-white font-medium text-lg">{selectedEmployee.name}</p>
              <p className="text-slate-500 text-sm capitalize">{selectedEmployee.role}</p>
            </div>

            {employeeHasNoPin ? (
              <div className="text-center text-sm text-slate-400 py-2">
                {lang === 'es' ? 'Sin PIN configurado — toca Clock In para entrar.' : 'No PIN configured — tap Clock In to enter.'}
              </div>
            ) : (
              <div>
                <label className="text-sm text-slate-400 block mb-2">
                  {L.enterPinFor} {selectedEmployee.name}
                </label>
                <input
                  type="password"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, ''));
                    setError(false);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="••••"
                  className={`input text-center text-3xl tracking-[0.5em] ${
                    error ? 'border-red-500 ring-1 ring-red-500/50' : ''
                  }`}
                  autoFocus
                />
                {error && (
                  <p className="text-red-400 text-sm text-center mt-2">{L.invalidPin}</p>
                )}
              </div>
            )}

            {employeeHasNoPin ? (
              <button
                className="btn btn-primary w-full"
                onClick={handleNoPinLogin}
              >
                {L.clockIn} →
              </button>
            ) : (
              <button
                className="btn btn-primary w-full"
                onClick={handlePinSubmit}
                disabled={!pin}
              >
                {L.clockIn} →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
