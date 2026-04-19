import { useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { getLabels } from '@/config/i18n';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import EmployeeSection from './EmployeeSection';

export default function EmployeesModule() {
  const { state: { employees, lang, settings, currentEmployee }, setEmployees } = useApp();
  const L = getLabels(lang);
  const es = lang === 'es';
  const [search, setSearch] = useState('');

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">👥 {L.employees || 'Employees'}</h1>
      <GlobalSearchBar
        localValue={search}
        onLocalChange={setSearch}
        placeholder={es ? 'Buscar empleados, clientes, tickets...' : 'Search employees, customers, tickets...'}
      />
      <EmployeeSection
        employees={employees}
        setEmployees={setEmployees}
        lang={lang}
        L={L}
        settings={settings}
        currentEmployee={currentEmployee}
      />
    </div>
  );
}