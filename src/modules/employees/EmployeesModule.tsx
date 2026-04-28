import { useState } from 'react';
import { useApp } from '@/store/AppProvider';
import { useTranslation } from '@/i18n';
import GlobalSearchBar from '@/components/shared/GlobalSearchBar';
import EmployeeSection from './EmployeeSection';

export default function EmployeesModule() {
  const { state: { employees, settings, currentEmployee }, setEmployees } = useApp();
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">👥 {t('employees.title')}</h1>
      <GlobalSearchBar
        localValue={search}
        onLocalChange={setSearch}
        placeholder={t('employees.searchPlaceholder')}
      />
      <EmployeeSection
        employees={employees}
        setEmployees={setEmployees}
        settings={settings}
        currentEmployee={currentEmployee}
      />
    </div>
  );
}