(() => {
  const KEEP_ID = 'mlfnta9pdnj50h7gxkq';
  const TARGET_NAME = 'JORGE OCHOA';
  const STORAGE_KEY = 'cellhub_employees';
  const BACKUP_KEY = '_dedupe_backup_employees';
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) { console.warn('no data'); return; }
  const employees = JSON.parse(raw);
  const before = employees.length;
  const dupes = employees.filter(e => e && e.name === TARGET_NAME && e.id !== KEEP_ID);
  console.info('Total:', before, 'Dupes:', dupes.length);
  if (dupes.length === 0) { console.info('No dupes. Done.'); return; }
  localStorage.setItem(BACKUP_KEY, JSON.stringify(employees));
  const next = employees.filter(e => !(e && e.name === TARGET_NAME && e.id !== KEEP_ID));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  console.info('Antes:', before, 'Despues:', next.length);
  console.info('Eliminados:', dupes.map(d => d.id));
  console.info('Conservado:', next.find(e => e.name === TARGET_NAME).id);
})();