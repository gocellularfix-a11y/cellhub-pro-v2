# TopUp Memory + Customer + Search — CellHub Pro v2

Antes de proponer cambios, lee estos archivos para entender el estado actual:
- `src/modules/pos/TopUpModal.tsx`
- `src/store/types.ts`
- `src/store/AppProvider.tsx` (solo para entender shape, NO modificar)
- Busca si existe `CustomerPicker` o componente similar: `grep -r "CustomerPicker" src/`
- Revisa cómo POSModule selecciona customers actualmente para reusar el patrón

Después muéstrame el plan de archivos que vas a crear/modificar y ESPERA mi OK antes de ejecutar nada.

---

## Contexto

`TopUpModal.tsx` (435 líneas) tiene lógica de "frecuentes" vía regex sobre `sales[].items[].notes` (líneas 38-69), pero en producción Jorge tiene que re-escribir toda la info en cada venta. Faltan: (1) selector de Customer — la memoria debería amarrarse al cliente, (2) search bar para filtrar recipients cuando un cliente tiene muchos números.

## Cambios requeridos (surgical, NO rewrite)

### 1. Customer selector (NUEVO — arriba del Provider)
- Reusar `CustomerPicker` si existe; si no, dropdown con autocomplete que filtre `state.customers` por nombre/teléfono
- Mostrar: nombre + teléfono principal
- Botón "+ Nuevo Cliente" inline (firstName, lastName, phone mínimo)
- Al seleccionar customer → auto-rellenar `sender` con su teléfono principal si está vacío
- Customer es **opcional** — walk-in sigue funcionando

### 2. Memoria persistente amarrada al customerId

```ts
// src/store/types.ts — AGREGAR como export nuevo, NO modificar nada existente
export interface TopUpHistoryEntry {
  customerId: string;
  senders: string[];
  recipients: {
    number: string;
    nickname?: string;
    provider: string;
    lastAmount: number;   // cents
    count: number;
    lastDate: number;     // timestamp ms
  }[];
}
```

- Firestore collection `topUpHistory` (doc id = customerId)
- Fallback localStorage key `topUpHistory_{customerId}`
- `serverTimestamp()` al escribir, `toDate()` al leer
- Walk-in (sin customer) → mantener lógica actual de regex sobre sales

### 3. Hook `src/hooks/useTopUpHistory.ts` (NUEVO)
- `getHistoryForCustomer(customerId: string): TopUpHistoryEntry | null`
- `getRecipientsForSender(sender: string): Recipient[]` — fallback walk-in
- `recordTopUp(customerId | null, sender, recipient, provider, amountCents)` — upsert
- `updateNickname(customerId, recipientNumber, nickname)`
- Defensive: Firebase no disponible → localStorage; localStorage corrupto → array vacío, no crash
- Todos los boundaries con try/catch

### 4. Search bar para recipients
- Cuando customer tenga 4+ recipients, mostrar input arriba de las cards
- Placeholder ES: "Buscar por número o alias" / EN: "Search by number or nickname"
- Filtra en tiempo real por substring (número o nickname)
- <4 recipients → ocultar search

### 5. Recipients como cards (cuando hay customer seleccionado)
- 📞 + número
- Nickname si existe ("Mamá", "Hermano")
- Carrier + último monto: `Telcel · $10.00`
- Badge count: `(5x)`
- Fecha relativa: `hace 3 días` / `3 days ago`
- Click → pre-llena recipient + provider + lastAmount en la línea activa
- Botón ✏️ inline para editar nickname (prompt via modal, NUNCA window.prompt)

Walk-in sin customer → mantener chips simples actuales.

### 6. Modificar `TopUpModal.tsx` quirúrgicamente
- **NO borrar** `frequentSenders` (líneas 38-51) — fallback walk-in
- **REEMPLAZAR** `frequentRecipients` useMemo (líneas 54-69) con lectura de `useTopUpHistory`
- Agregar state: `customerId`, `recipientSearch`, `editingNicknameFor`
- En `handleSubmit` (línea 104), después de `onAddToCart(items)`, llamar `recordTopUp()` por cada línea válida

### 7. Migración one-time desde sales pasadas
- Al PRIMER mount del hook, escanear `sales` con el regex actual
- Solo sales que tengan `customerId` definido
- Poblar `topUpHistory` sin duplicar si ya existe
- Marcar como migrado con flag `topUpHistoryMigrated_v1` en localStorage para NO correr de nuevo
- Si crashea la migración → log y continuar, no bloquear el app

## Restricciones CRÍTICAS
- **NO modificar** reducers, actions, ni el shape de `AppState` en `src/store/`. Solo puedes AGREGAR el tipo `TopUpHistoryEntry` a `src/store/types.ts` como export nuevo. Si crees necesitar un reducer action nuevo, DETENTE y pregúntame.
- **NO rewrite** del modal entero — solo las secciones señaladas
- **NUNCA** usar `alert()`, `confirm()`, `prompt()` — siempre modales React
- Money en cents siempre (int)
- Bilingual EN/ES en todo texto nuevo
- Defensive en todos los Firestore/localStorage boundaries
- Si agregas campos a StoreSettings usa double-cast: `(settings as any).fieldName as TargetType`

## Al terminar
1. Corre `npm run typecheck` y pégame el output COMPLETO
2. Dime exactamente qué archivos creaste/modificaste (lista limpia)
3. Genera el tarball: `cd .. && tar -czf cellhub-pro-v2_topup-memory_cc.tar.gz cellhub-pro-v2/`
4. Confirma tamaño del tar y ubicación

## Criterio de aceptación
1. Abrir modal → selector de Customer arriba de todo
2. Seleccionar customer → auto-rellena sender con teléfono principal, muestra sus recipients como cards
3. Customer con 4+ recipients → search bar funcional
4. Click en recipient card → pre-llena número + provider + último monto
5. Editar nickname vía modal → persiste
6. Completar venta → historial se actualiza (count +1, lastAmount, lastDate, provider)
7. Walk-in sin customer → funciona igual que antes
8. Refresh del app → historial persiste (Firestore o localStorage)
9. Migración one-time corre una sola vez, no en cada mount
10. `npm run typecheck` pasa limpio, cero errores nuevos
