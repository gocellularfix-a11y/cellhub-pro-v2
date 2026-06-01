// ============================================================
// R-HELP-MANUAL-V1 — Internal Help / Manual content (data-driven).
//
// This file is the SINGLE source of truth for the in-app manual. Content is
// a structured, localized map (EN/ES/PT) — NOT scattered JSX. Developers edit
// the documentation here; HelpModule.tsx renders it generically.
//
// Conventions:
//   - Every user-facing string is localized via LocalizedText / LocalizedList.
//   - PT falls back visually to EN only if a field is left empty (we provide
//     full PT here).
//   - `related` references other module ids in this file (clickable chips).
// ============================================================

export type HelpLocale = 'en' | 'es' | 'pt';
export type LocalizedText = Record<HelpLocale, string>;
export type LocalizedList = Record<HelpLocale, string[]>;

export interface HelpModuleEntry {
  id: string;
  icon: string;
  title: LocalizedText;
  /** One-line summary shown under the title and used by search. */
  summary: LocalizedText;
  whatItDoes: LocalizedText;
  commonActions: LocalizedList;
  steps: LocalizedList;
  warnings: LocalizedList;
  troubleshooting: LocalizedList;
  /** ids of related HelpModuleEntry items. */
  related: string[];
}

export const HELP_MODULES: HelpModuleEntry[] = [
  // ── POS ───────────────────────────────────────────────────
  {
    id: 'pos',
    icon: '💰',
    title: { en: 'Point of Sale', es: 'Punto de Venta', pt: 'Ponto de Venda' },
    summary: {
      en: 'Ring up products and services, take payment, and print receipts.',
      es: 'Cobra productos y servicios, recibe pagos e imprime recibos.',
      pt: 'Registre produtos e serviços, receba pagamentos e imprima recibos.',
    },
    whatItDoes: {
      en: 'POS is the checkout. Add inventory items or services to the cart, apply tax automatically, take a deposit or full payment, and generate a receipt. Completed sales feed Reports and inventory counts.',
      es: 'El POS es la caja. Agrega artículos de inventario o servicios al carrito, aplica el impuesto automáticamente, recibe un depósito o pago completo y genera un recibo. Las ventas completadas alimentan los Reportes y el conteo de inventario.',
      pt: 'O PDV é o caixa. Adicione itens de estoque ou serviços ao carrinho, aplique o imposto automaticamente, receba um sinal ou pagamento total e gere um recibo. Vendas concluídas alimentam os Relatórios e a contagem de estoque.',
    },
    commonActions: {
      en: ['Add an item or service to the cart', 'Attach a customer to the sale', 'Take a deposit or full payment', 'Print or re-print the receipt'],
      es: ['Agregar un artículo o servicio al carrito', 'Asociar un cliente a la venta', 'Recibir un depósito o pago completo', 'Imprimir o reimprimir el recibo'],
      pt: ['Adicionar um item ou serviço ao carrinho', 'Vincular um cliente à venda', 'Receber um sinal ou pagamento total', 'Imprimir ou reimprimir o recibo'],
    },
    steps: {
      en: [
        'Open POS from the sidebar.',
        'Search or scan items to add them to the cart.',
        'Optional: attach a customer so the sale shows in their history.',
        'Choose the payment method and enter the amount tendered.',
        'Confirm to complete the sale — the receipt prints automatically.',
      ],
      es: [
        'Abre el POS desde la barra lateral.',
        'Busca o escanea artículos para agregarlos al carrito.',
        'Opcional: asocia un cliente para que la venta aparezca en su historial.',
        'Elige el método de pago e ingresa el monto recibido.',
        'Confirma para completar la venta — el recibo se imprime automáticamente.',
      ],
      pt: [
        'Abra o PDV na barra lateral.',
        'Busque ou escaneie itens para adicioná-los ao carrinho.',
        'Opcional: vincule um cliente para que a venda apareça no histórico dele.',
        'Escolha a forma de pagamento e informe o valor recebido.',
        'Confirme para concluir a venda — o recibo é impresso automaticamente.',
      ],
    },
    warnings: {
      en: [
        'A completed sale cannot be edited. To reverse it, use Mark Refunded — it creates a negative sale so Reports stay correct.',
        'Tax is calculated by the system. Do not adjust totals manually.',
      ],
      es: [
        'Una venta completada no se puede editar. Para revertirla usa Marcar Reembolsado — crea una venta negativa para que los Reportes queden correctos.',
        'El impuesto lo calcula el sistema. No ajustes los totales manualmente.',
      ],
      pt: [
        'Uma venda concluída não pode ser editada. Para revertê-la use Marcar como Reembolsado — cria uma venda negativa para manter os Relatórios corretos.',
        'O imposto é calculado pelo sistema. Não ajuste os totais manualmente.',
      ],
    },
    troubleshooting: {
      en: [
        'Receipt did not print? Check the selected printer in Settings → Hardware.',
        'Item not found? Confirm it exists and has stock in Inventory.',
      ],
      es: [
        '¿No se imprimió el recibo? Revisa la impresora seleccionada en Configuración → Hardware.',
        '¿No aparece el artículo? Confirma que existe y tiene stock en Inventario.',
      ],
      pt: [
        'O recibo não imprimiu? Verifique a impressora selecionada em Configurações → Hardware.',
        'Item não encontrado? Confirme que ele existe e tem estoque no Estoque.',
      ],
    },
    related: ['inventory', 'customers', 'reports'],
  },

  // ── Repairs ───────────────────────────────────────────────
  {
    id: 'repairs',
    icon: '🔧',
    title: { en: 'Repairs', es: 'Reparaciones', pt: 'Reparos' },
    summary: {
      en: 'Intake devices, track repair status, and collect the balance.',
      es: 'Registra dispositivos, sigue el estado de la reparación y cobra el saldo.',
      pt: 'Registre aparelhos, acompanhe o status do reparo e receba o saldo.',
    },
    whatItDoes: {
      en: 'Repairs tracks a device from intake to pickup. Record the problem, an estimated cost, an optional deposit, and move the ticket through its status until the customer pays the balance and picks up.',
      es: 'Reparaciones sigue un dispositivo desde la recepción hasta la entrega. Registra el problema, un costo estimado, un depósito opcional y mueve el ticket por sus estados hasta que el cliente paga el saldo y lo recoge.',
      pt: 'Reparos acompanha um aparelho da entrada até a retirada. Registre o problema, um custo estimado, um sinal opcional e mova o ticket pelos status até o cliente pagar o saldo e retirar.',
    },
    commonActions: {
      en: ['Create a repair ticket', 'Update repair status', 'Collect the remaining balance', 'Reprint the ticket or receipt'],
      es: ['Crear un ticket de reparación', 'Actualizar el estado de la reparación', 'Cobrar el saldo restante', 'Reimprimir el ticket o recibo'],
      pt: ['Criar um ticket de reparo', 'Atualizar o status do reparo', 'Receber o saldo restante', 'Reimprimir o ticket ou recibo'],
    },
    steps: {
      en: [
        'Open Repairs and create a new ticket.',
        'Select the customer and describe the device and problem.',
        'Enter the estimated cost and any deposit taken.',
        'Update status as work progresses (received → in progress → ready).',
        'On pickup, collect the balance and mark it picked up.',
      ],
      es: [
        'Abre Reparaciones y crea un ticket nuevo.',
        'Selecciona el cliente y describe el dispositivo y el problema.',
        'Ingresa el costo estimado y cualquier depósito recibido.',
        'Actualiza el estado conforme avanza el trabajo (recibido → en progreso → listo).',
        'Al entregar, cobra el saldo y márcalo como recogido.',
      ],
      pt: [
        'Abra Reparos e crie um novo ticket.',
        'Selecione o cliente e descreva o aparelho e o problema.',
        'Informe o custo estimado e qualquer sinal recebido.',
        'Atualize o status conforme o trabalho avança (recebido → em andamento → pronto).',
        'Na retirada, receba o saldo e marque como retirado.',
      ],
    },
    warnings: {
      en: [
        'Once a ticket is fully paid (balance 0) it locks. Editing money fields then requires the Admin PIN and a documented reason.',
        'A cancelled or refunded ticket cannot be edited — start a new one if needed.',
      ],
      es: [
        'Cuando un ticket queda totalmente pagado (saldo 0) se bloquea. Editar campos de dinero requiere el PIN de Administrador y una razón documentada.',
        'Un ticket cancelado o reembolsado no se puede editar — crea uno nuevo si hace falta.',
      ],
      pt: [
        'Quando um ticket é totalmente pago (saldo 0) ele trava. Editar campos de dinheiro exige o PIN de Administrador e um motivo documentado.',
        'Um ticket cancelado ou reembolsado não pode ser editado — crie um novo se necessário.',
      ],
    },
    troubleshooting: {
      en: [
        'Cannot edit the price? The ticket is likely paid/locked — use the Admin PIN edit flow.',
        'Balance looks wrong after an edit? Confirm the deposit and the reason you selected (additional balance vs. absorbed vs. refund).',
      ],
      es: [
        '¿No puedes editar el precio? El ticket probablemente está pagado/bloqueado — usa el flujo de edición con PIN de Administrador.',
        '¿El saldo se ve mal tras una edición? Confirma el depósito y la razón que elegiste (saldo adicional vs. absorbido vs. reembolso).',
      ],
      pt: [
        'Não consegue editar o preço? O ticket provavelmente está pago/travado — use o fluxo de edição com PIN de Administrador.',
        'O saldo parece errado após uma edição? Confirme o sinal e o motivo escolhido (saldo adicional vs. absorvido vs. reembolso).',
      ],
    },
    related: ['customers', 'unlocks', 'inventory'],
  },

  // ── Layaways ──────────────────────────────────────────────
  {
    id: 'layaways',
    icon: '📅',
    title: { en: 'Layaways', es: 'Apartados', pt: 'Crediário' },
    summary: {
      en: 'Reserve an item with a deposit and collect scheduled payments.',
      es: 'Aparta un artículo con un depósito y cobra pagos programados.',
      pt: 'Reserve um item com um sinal e receba pagamentos programados.',
    },
    whatItDoes: {
      en: 'Layaways lets a customer reserve an item by paying a deposit, then pay the remaining balance over time. The item is held until the balance reaches zero.',
      es: 'Apartados permite que un cliente reserve un artículo pagando un depósito y luego pague el saldo restante con el tiempo. El artículo se reserva hasta que el saldo llega a cero.',
      pt: 'Crediário permite que um cliente reserve um item pagando um sinal e depois quite o saldo ao longo do tempo. O item fica reservado até o saldo chegar a zero.',
    },
    commonActions: {
      en: ['Start a new layaway with a deposit', 'Record a payment toward the balance', 'View the remaining balance', 'Cancel a layaway'],
      es: ['Iniciar un apartado nuevo con depósito', 'Registrar un pago al saldo', 'Ver el saldo restante', 'Cancelar un apartado'],
      pt: ['Iniciar um novo crediário com sinal', 'Registrar um pagamento no saldo', 'Ver o saldo restante', 'Cancelar um crediário'],
    },
    steps: {
      en: [
        'Open Layaways and start a new one.',
        'Select the customer and the item, then enter the price and deposit.',
        'Record each payment as the customer pays it down.',
        'When the balance hits zero, complete the layaway and hand over the item.',
      ],
      es: [
        'Abre Apartados e inicia uno nuevo.',
        'Selecciona el cliente y el artículo, luego ingresa el precio y el depósito.',
        'Registra cada pago conforme el cliente abona.',
        'Cuando el saldo llegue a cero, completa el apartado y entrega el artículo.',
      ],
      pt: [
        'Abra Crediário e inicie um novo.',
        'Selecione o cliente e o item, depois informe o preço e o sinal.',
        'Registre cada pagamento conforme o cliente quita.',
        'Quando o saldo chegar a zero, conclua o crediário e entregue o item.',
      ],
    },
    warnings: {
      en: [
        'Deposits are reconciled through POS checkout. Do not adjust the deposit elsewhere.',
        'Cancelling a layaway follows the store refund policy — confirm before cancelling.',
      ],
      es: [
        'Los depósitos se reconcilian a través del cobro en POS. No ajustes el depósito en otro lugar.',
        'Cancelar un apartado sigue la política de reembolsos de la tienda — confirma antes de cancelar.',
      ],
      pt: [
        'Os sinais são reconciliados pelo caixa do PDV. Não ajuste o sinal em outro lugar.',
        'Cancelar um crediário segue a política de reembolso da loja — confirme antes de cancelar.',
      ],
    },
    troubleshooting: {
      en: [
        'Payment not reflected? Reopen the layaway and confirm the amount was recorded.',
        'Balance mismatch? Check whether tax applies to the item.',
      ],
      es: [
        '¿No se refleja el pago? Vuelve a abrir el apartado y confirma que el monto se registró.',
        '¿No cuadra el saldo? Revisa si el artículo lleva impuesto.',
      ],
      pt: [
        'Pagamento não refletido? Reabra o crediário e confirme que o valor foi registrado.',
        'Saldo divergente? Verifique se o item tem imposto.',
      ],
    },
    related: ['pos', 'customers', 'reports'],
  },

  // ── Unlocks ───────────────────────────────────────────────
  {
    id: 'unlocks',
    icon: '🔓',
    title: { en: 'Unlocks', es: 'Liberaciones', pt: 'Desbloqueios' },
    summary: {
      en: 'Manage carrier/network unlock orders and their status.',
      es: 'Gestiona órdenes de liberación de operador/red y su estado.',
      pt: 'Gerencie pedidos de desbloqueio de operadora/rede e seu status.',
    },
    whatItDoes: {
      en: 'Unlocks tracks network/carrier unlock requests: the device, the price, an optional deposit, and the order status from submitted to completed.',
      es: 'Liberaciones sigue las solicitudes de liberación de red/operador: el dispositivo, el precio, un depósito opcional y el estado de la orden desde enviada hasta completada.',
      pt: 'Desbloqueios acompanha os pedidos de desbloqueio de rede/operadora: o aparelho, o preço, um sinal opcional e o status do pedido de enviado até concluído.',
    },
    commonActions: {
      en: ['Create an unlock order', 'Update the unlock status', 'Collect the balance on completion'],
      es: ['Crear una orden de liberación', 'Actualizar el estado de la liberación', 'Cobrar el saldo al completar'],
      pt: ['Criar um pedido de desbloqueio', 'Atualizar o status do desbloqueio', 'Receber o saldo na conclusão'],
    },
    steps: {
      en: [
        'Open Unlocks and create an order.',
        'Enter the device/IMEI, customer, price and any deposit.',
        'Update status as the request is processed.',
        'On completion, collect the balance and mark it done.',
      ],
      es: [
        'Abre Liberaciones y crea una orden.',
        'Ingresa el dispositivo/IMEI, el cliente, el precio y cualquier depósito.',
        'Actualiza el estado conforme se procesa la solicitud.',
        'Al completar, cobra el saldo y márcala como terminada.',
      ],
      pt: [
        'Abra Desbloqueios e crie um pedido.',
        'Informe o aparelho/IMEI, o cliente, o preço e qualquer sinal.',
        'Atualize o status conforme o pedido é processado.',
        'Na conclusão, receba o saldo e marque como finalizado.',
      ],
    },
    warnings: {
      en: ['A cancelled unlock cannot be re-edited. Confirm the IMEI before submitting — it is hard to reverse.'],
      es: ['Una liberación cancelada no se puede volver a editar. Confirma el IMEI antes de enviar — es difícil de revertir.'],
      pt: ['Um desbloqueio cancelado não pode ser editado de novo. Confirme o IMEI antes de enviar — é difícil de reverter.'],
    },
    troubleshooting: {
      en: ['Order stuck? Update the status manually to reflect the provider response.'],
      es: ['¿Orden atascada? Actualiza el estado manualmente para reflejar la respuesta del proveedor.'],
      pt: ['Pedido travado? Atualize o status manualmente para refletir a resposta do fornecedor.'],
    },
    related: ['repairs', 'customers'],
  },

  // ── Phone Payments ────────────────────────────────────────
  {
    id: 'phonePayments',
    icon: '📲',
    title: { en: 'Phone Payments', es: 'Pagos de Teléfono', pt: 'Pagamentos de Celular' },
    summary: {
      en: 'Process wireless bill payments and prepaid top-ups.',
      es: 'Procesa pagos de servicio móvil y recargas prepago.',
      pt: 'Processe pagamentos de conta de celular e recargas pré-pagas.',
    },
    whatItDoes: {
      en: 'Phone Payments handles carrier bill payments and prepaid top-ups, including the carrier portal link and any commission the store earns on the transaction.',
      es: 'Pagos de Teléfono maneja pagos de factura de operador y recargas prepago, incluyendo el enlace al portal del operador y la comisión que gana la tienda en la transacción.',
      pt: 'Pagamentos de Celular cuida de pagamentos de conta de operadora e recargas pré-pagas, incluindo o link do portal da operadora e a comissão que a loja ganha na transação.',
    },
    commonActions: {
      en: ['Take a carrier bill payment', 'Sell a prepaid top-up', 'Open the carrier portal'],
      es: ['Recibir un pago de factura de operador', 'Vender una recarga prepago', 'Abrir el portal del operador'],
      pt: ['Receber um pagamento de conta de operadora', 'Vender uma recarga pré-paga', 'Abrir o portal da operadora'],
    },
    steps: {
      en: [
        'Open Phone Payments.',
        'Choose the carrier and the payment or top-up amount.',
        'Open the carrier portal and complete the payment there.',
        'Record the transaction so the commission is captured in Reports.',
      ],
      es: [
        'Abre Pagos de Teléfono.',
        'Elige el operador y el monto del pago o recarga.',
        'Abre el portal del operador y completa el pago ahí.',
        'Registra la transacción para que la comisión quede en los Reportes.',
      ],
      pt: [
        'Abra Pagamentos de Celular.',
        'Escolha a operadora e o valor do pagamento ou recarga.',
        'Abra o portal da operadora e conclua o pagamento lá.',
        'Registre a transação para que a comissão seja capturada nos Relatórios.',
      ],
    },
    warnings: {
      en: ['Always confirm the carrier portal returned a successful confirmation before recording the sale.'],
      es: ['Siempre confirma que el portal del operador devolvió una confirmación exitosa antes de registrar la venta.'],
      pt: ['Sempre confirme que o portal da operadora retornou uma confirmação de sucesso antes de registrar a venda.'],
    },
    troubleshooting: {
      en: ['Portal will not open? Verify the portal URL uses https:// in Settings.'],
      es: ['¿No abre el portal? Verifica que la URL del portal use https:// en Configuración.'],
      pt: ['O portal não abre? Verifique se a URL do portal usa https:// em Configurações.'],
    },
    related: ['pos', 'reports', 'settings'],
  },

  // ── Inventory ─────────────────────────────────────────────
  {
    id: 'inventory',
    icon: '📦',
    title: { en: 'Inventory', es: 'Inventario', pt: 'Estoque' },
    summary: {
      en: 'Track stock items, costs, prices, and low/dead stock.',
      es: 'Controla artículos, costos, precios y stock bajo/muerto.',
      pt: 'Controle itens de estoque, custos, preços e estoque baixo/parado.',
    },
    whatItDoes: {
      en: 'Inventory holds every product you sell: SKU, cost, price, and quantity on hand. It powers POS lookups and flags low stock and dead stock for restocking decisions.',
      es: 'Inventario contiene cada producto que vendes: SKU, costo, precio y cantidad disponible. Alimenta las búsquedas del POS y marca el stock bajo y muerto para decisiones de reabastecimiento.',
      pt: 'Estoque contém cada produto que você vende: SKU, custo, preço e quantidade em mãos. Alimenta as buscas do PDV e sinaliza estoque baixo e parado para decisões de reposição.',
    },
    commonActions: {
      en: ['Add or edit a product', 'Adjust quantity on hand', 'Review low and dead stock', 'Promote an item to Intelligence'],
      es: ['Agregar o editar un producto', 'Ajustar la cantidad disponible', 'Revisar stock bajo y muerto', 'Promover un artículo en Intelligence'],
      pt: ['Adicionar ou editar um produto', 'Ajustar a quantidade em mãos', 'Revisar estoque baixo e parado', 'Promover um item no Intelligence'],
    },
    steps: {
      en: [
        'Open Inventory.',
        'Add a product with its SKU, cost and price.',
        'Set the starting quantity.',
        'Use the low-stock view to decide what to reorder.',
      ],
      es: [
        'Abre Inventario.',
        'Agrega un producto con su SKU, costo y precio.',
        'Define la cantidad inicial.',
        'Usa la vista de stock bajo para decidir qué reordenar.',
      ],
      pt: [
        'Abra Estoque.',
        'Adicione um produto com SKU, custo e preço.',
        'Defina a quantidade inicial.',
        'Use a visão de estoque baixo para decidir o que repor.',
      ],
    },
    warnings: {
      en: ['Cost and price are stored in cents. Enter dollar amounts in the fields — the system converts them.'],
      es: ['El costo y el precio se guardan en centavos. Ingresa montos en pesos/dólares en los campos — el sistema los convierte.'],
      pt: ['Custo e preço são armazenados em centavos. Informe os valores em reais/dólares nos campos — o sistema converte.'],
    },
    troubleshooting: {
      en: ['Item not appearing in POS? Confirm it has quantity in stock and is not archived.'],
      es: ['¿El artículo no aparece en el POS? Confirma que tenga cantidad en stock y no esté archivado.'],
      pt: ['Item não aparece no PDV? Confirme que tem quantidade em estoque e não está arquivado.'],
    },
    related: ['pos', 'reports'],
  },

  // ── Customers ─────────────────────────────────────────────
  {
    id: 'customers',
    icon: '👤',
    title: { en: 'Customers', es: 'Clientes', pt: 'Clientes' },
    summary: {
      en: 'Manage customer profiles, history, and store credit.',
      es: 'Gestiona perfiles de clientes, historial y crédito de tienda.',
      pt: 'Gerencie perfis de clientes, histórico e crédito da loja.',
    },
    whatItDoes: {
      en: 'Customers stores each person you serve: contact details, full purchase/repair history, and any store credit. Attaching a customer to a sale or repair builds their history automatically.',
      es: 'Clientes guarda a cada persona que atiendes: datos de contacto, historial completo de compras/reparaciones y cualquier crédito de tienda. Asociar un cliente a una venta o reparación construye su historial automáticamente.',
      pt: 'Clientes guarda cada pessoa que você atende: dados de contato, histórico completo de compras/reparos e qualquer crédito da loja. Vincular um cliente a uma venda ou reparo monta o histórico automaticamente.',
    },
    commonActions: {
      en: ['Add or edit a customer', 'View purchase and repair history', 'Contact the customer', 'Apply or review store credit'],
      es: ['Agregar o editar un cliente', 'Ver historial de compras y reparaciones', 'Contactar al cliente', 'Aplicar o revisar crédito de tienda'],
      pt: ['Adicionar ou editar um cliente', 'Ver histórico de compras e reparos', 'Contatar o cliente', 'Aplicar ou revisar crédito da loja'],
    },
    steps: {
      en: [
        'Open Customers.',
        'Add a new customer or search for an existing one.',
        'Open their profile to see full history across modules.',
        'Use Contact to reach them by phone or message.',
      ],
      es: [
        'Abre Clientes.',
        'Agrega un cliente nuevo o busca uno existente.',
        'Abre su perfil para ver el historial completo entre módulos.',
        'Usa Contactar para comunicarte por teléfono o mensaje.',
      ],
      pt: [
        'Abra Clientes.',
        'Adicione um novo cliente ou busque um existente.',
        'Abra o perfil para ver o histórico completo entre módulos.',
        'Use Contatar para falar por telefone ou mensagem.',
      ],
    },
    warnings: {
      en: ['Customers are shared across stores in multi-store mode. Edits affect every location.'],
      es: ['Los clientes se comparten entre tiendas en modo multi-tienda. Las ediciones afectan a todas las ubicaciones.'],
      pt: ['Os clientes são compartilhados entre lojas no modo multi-loja. As edições afetam todas as unidades.'],
    },
    troubleshooting: {
      en: ['Duplicate customer? Search by phone number before creating a new profile.'],
      es: ['¿Cliente duplicado? Busca por número de teléfono antes de crear un perfil nuevo.'],
      pt: ['Cliente duplicado? Busque pelo número de telefone antes de criar um novo perfil.'],
    },
    related: ['pos', 'repairs', 'intelligence'],
  },

  // ── Reports ───────────────────────────────────────────────
  {
    id: 'reports',
    icon: '📈',
    title: { en: 'Reports', es: 'Reportes', pt: 'Relatórios' },
    summary: {
      en: 'See revenue, profit, and tax figures by period.',
      es: 'Consulta ingresos, ganancia e impuestos por periodo.',
      pt: 'Veja receita, lucro e impostos por período.',
    },
    whatItDoes: {
      en: 'Reports aggregates all completed transactions into revenue, profit and tax totals. Refunds and negative sales are subtracted so the numbers reflect real net performance.',
      es: 'Reportes agrega todas las transacciones completadas en totales de ingresos, ganancia e impuestos. Los reembolsos y ventas negativas se restan para que los números reflejen el desempeño neto real.',
      pt: 'Relatórios agrega todas as transações concluídas em totais de receita, lucro e imposto. Reembolsos e vendas negativas são subtraídos para que os números reflitam o desempenho líquido real.',
    },
    commonActions: {
      en: ['Pick a date range', 'Review revenue and profit', 'Check tax collected', 'Export figures for accounting'],
      es: ['Elegir un rango de fechas', 'Revisar ingresos y ganancia', 'Verificar el impuesto cobrado', 'Exportar cifras para contabilidad'],
      pt: ['Escolher um intervalo de datas', 'Revisar receita e lucro', 'Verificar o imposto recolhido', 'Exportar números para a contabilidade'],
    },
    steps: {
      en: [
        'Open Reports (Admin PIN required).',
        'Select the period you want to review.',
        'Read revenue, profit and tax for that period.',
        'Cross-check against Tax Reports for filing.',
      ],
      es: [
        'Abre Reportes (requiere PIN de Administrador).',
        'Selecciona el periodo que quieres revisar.',
        'Lee ingresos, ganancia e impuesto de ese periodo.',
        'Compara contra Reportes de Impuestos para la declaración.',
      ],
      pt: [
        'Abra Relatórios (exige PIN de Administrador).',
        'Selecione o período que deseja revisar.',
        'Leia receita, lucro e imposto desse período.',
        'Compare com Relatórios de Imposto para a declaração.',
      ],
    },
    warnings: {
      en: ['Profit, cost and margin can be hidden by Financial Privacy. If you cannot see them, an owner has restricted access.'],
      es: ['La ganancia, el costo y el margen pueden estar ocultos por Privacidad Financiera. Si no los ves, un propietario restringió el acceso.'],
      pt: ['Lucro, custo e margem podem estar ocultos pela Privacidade Financeira. Se você não os vê, um proprietário restringiu o acesso.'],
    },
    troubleshooting: {
      en: ['Numbers look low? Confirm the date range and that refunds were entered as Mark Refunded, not deletions.'],
      es: ['¿Los números se ven bajos? Confirma el rango de fechas y que los reembolsos se hayan hecho con Marcar Reembolsado, no borrados.'],
      pt: ['Números parecem baixos? Confirme o intervalo de datas e que os reembolsos foram feitos com Marcar como Reembolsado, não exclusões.'],
    },
    related: ['tax', 'financialPrivacy', 'settings'],
  },

  // ── Settings ──────────────────────────────────────────────
  {
    id: 'settings',
    icon: '⚙️',
    title: { en: 'Settings', es: 'Configuración', pt: 'Configurações' },
    summary: {
      en: 'Store info, tax rate, hardware, security and appearance.',
      es: 'Datos de la tienda, impuesto, hardware, seguridad y apariencia.',
      pt: 'Dados da loja, imposto, hardware, segurança e aparência.',
    },
    whatItDoes: {
      en: 'Settings is the control panel: store details, tax rate, receipt printers, the Admin PIN, appearance themes, and (where enabled) multi-store and Financial Privacy.',
      es: 'Configuración es el panel de control: datos de la tienda, tasa de impuesto, impresoras de recibos, el PIN de Administrador, temas de apariencia y (donde esté habilitado) multi-tienda y Privacidad Financiera.',
      pt: 'Configurações é o painel de controle: dados da loja, alíquota de imposto, impressoras de recibo, o PIN de Administrador, temas de aparência e (onde habilitado) multi-loja e Privacidade Financeira.',
    },
    commonActions: {
      en: ['Edit store name and address', 'Set the tax rate', 'Select receipt printers', 'Change the Admin PIN'],
      es: ['Editar nombre y dirección de la tienda', 'Definir la tasa de impuesto', 'Seleccionar impresoras de recibos', 'Cambiar el PIN de Administrador'],
      pt: ['Editar nome e endereço da loja', 'Definir a alíquota de imposto', 'Selecionar impressoras de recibo', 'Alterar o PIN de Administrador'],
    },
    steps: {
      en: [
        'Open Settings (Admin PIN required).',
        'Pick the section on the left (Store, Taxes, Hardware, etc.).',
        'Make your change — most fields save automatically.',
        'For hardware, scan for printers and select the default.',
      ],
      es: [
        'Abre Configuración (requiere PIN de Administrador).',
        'Elige la sección a la izquierda (Tienda, Impuestos, Hardware, etc.).',
        'Haz tu cambio — la mayoría de los campos se guardan automáticamente.',
        'Para hardware, escanea impresoras y selecciona la predeterminada.',
      ],
      pt: [
        'Abra Configurações (exige PIN de Administrador).',
        'Escolha a seção à esquerda (Loja, Impostos, Hardware, etc.).',
        'Faça sua alteração — a maioria dos campos salva automaticamente.',
        'Para hardware, busque impressoras e selecione a padrão.',
      ],
    },
    warnings: {
      en: ['Changing the tax rate affects all new transactions. Past sales keep the rate they were charged.'],
      es: ['Cambiar la tasa de impuesto afecta todas las transacciones nuevas. Las ventas pasadas conservan la tasa que se les cobró.'],
      pt: ['Alterar a alíquota afeta todas as novas transações. Vendas passadas mantêm a alíquota cobrada na época.'],
    },
    troubleshooting: {
      en: ['Setting did not stick? Confirm you are in Admin mode and try again — settings save as a delta.'],
      es: ['¿No se guardó el ajuste? Confirma que estás en modo Administrador e intenta de nuevo — los ajustes se guardan como delta.'],
      pt: ['A configuração não salvou? Confirme que está no modo Administrador e tente novamente — as configurações salvam como delta.'],
    },
    related: ['financialPrivacy', 'backup', 'phonePayments'],
  },

  // ── Financial Privacy ─────────────────────────────────────
  {
    id: 'financialPrivacy',
    icon: '🔒',
    title: { en: 'Financial Privacy', es: 'Privacidad Financiera', pt: 'Privacidade Financeira' },
    summary: {
      en: 'Hide owner financials (profit, cost, margin) from employees.',
      es: 'Oculta las finanzas del propietario (ganancia, costo, margen) a los empleados.',
      pt: 'Oculta as finanças do dono (lucro, custo, margem) dos funcionários.',
    },
    whatItDoes: {
      en: 'Financial Privacy lets the owner hide profit, cost and margin figures from non-owner employees across Reports, Intelligence and other views, without removing their ability to do their job.',
      es: 'Privacidad Financiera permite al propietario ocultar las cifras de ganancia, costo y margen a los empleados que no son propietarios en Reportes, Intelligence y otras vistas, sin quitarles la capacidad de hacer su trabajo.',
      pt: 'Privacidade Financeira permite ao dono ocultar números de lucro, custo e margem dos funcionários que não são donos em Relatórios, Intelligence e outras telas, sem tirar a capacidade de trabalhar.',
    },
    commonActions: {
      en: ['Turn the privacy toggle on or off', 'Review what employees can and cannot see'],
      es: ['Activar o desactivar el interruptor de privacidad', 'Revisar qué pueden y qué no pueden ver los empleados'],
      pt: ['Ligar ou desligar a chave de privacidade', 'Revisar o que os funcionários podem ou não ver'],
    },
    steps: {
      en: [
        'Open Settings → Financial Privacy (Admin PIN required).',
        'Toggle "Hide owner financials from employees" on.',
        'Clock out and log in as an employee to verify the figures are hidden.',
      ],
      es: [
        'Abre Configuración → Privacidad Financiera (requiere PIN de Administrador).',
        'Activa "Ocultar finanzas del propietario a empleados".',
        'Cierra sesión e ingresa como empleado para verificar que las cifras están ocultas.',
      ],
      pt: [
        'Abra Configurações → Privacidade Financeira (exige PIN de Administrador).',
        'Ative "Ocultar finanças do dono dos funcionários".',
        'Saia e entre como funcionário para verificar que os números estão ocultos.',
      ],
    },
    warnings: {
      en: ['This is a visibility control, not a permission to alter data. Owners and managers always see financials.'],
      es: ['Esto controla la visibilidad, no el permiso para alterar datos. Propietarios y gerentes siempre ven las finanzas.'],
      pt: ['Isto controla a visibilidade, não a permissão de alterar dados. Donos e gerentes sempre veem as finanças.'],
    },
    troubleshooting: {
      en: ['Employee still sees profit? Confirm they are not logged in with an owner/manager role.'],
      es: ['¿El empleado aún ve la ganancia? Confirma que no haya iniciado sesión con un rol de propietario/gerente.'],
      pt: ['O funcionário ainda vê o lucro? Confirme que ele não está logado com papel de dono/gerente.'],
    },
    related: ['settings', 'reports', 'intelligence'],
  },

  // ── Backup & Restore ──────────────────────────────────────
  {
    id: 'backup',
    icon: '💾',
    title: { en: 'Backup & Restore', es: 'Respaldo y Restauración', pt: 'Backup e Restauração' },
    summary: {
      en: 'Export your data to a file and import it back.',
      es: 'Exporta tus datos a un archivo e impórtalos de vuelta.',
      pt: 'Exporte seus dados para um arquivo e importe de volta.',
    },
    whatItDoes: {
      en: 'Backup & Restore exports all local data (sales, customers, inventory, repairs and more) as a single JSON file, and imports a backup back in. Data lives on this device, so regular backups protect you against loss.',
      es: 'Respaldo y Restauración exporta todos los datos locales (ventas, clientes, inventario, reparaciones y más) como un solo archivo JSON, y restaura un respaldo de vuelta. Los datos viven en este dispositivo, así que respaldar con frecuencia te protege contra pérdidas.',
      pt: 'Backup e Restauração exporta todos os dados locais (vendas, clientes, estoque, reparos e mais) como um único arquivo JSON, e importa um backup de volta. Os dados ficam neste dispositivo, então backups frequentes protegem contra perdas.',
    },
    commonActions: {
      en: ['Export a full backup', 'Import a backup file', 'Check storage usage'],
      es: ['Exportar un respaldo completo', 'Importar un archivo de respaldo', 'Revisar el uso de almacenamiento'],
      pt: ['Exportar um backup completo', 'Importar um arquivo de backup', 'Verificar o uso de armazenamento'],
    },
    steps: {
      en: [
        'Open Settings → Backup (Admin PIN required).',
        'Click Export to download a JSON backup file.',
        'Store the file somewhere safe (USB, cloud drive).',
        'To restore, click Import and select a backup file.',
      ],
      es: [
        'Abre Configuración → Respaldo (requiere PIN de Administrador).',
        'Haz clic en Exportar para descargar un archivo JSON de respaldo.',
        'Guarda el archivo en un lugar seguro (USB, nube).',
        'Para restaurar, haz clic en Importar y selecciona un archivo de respaldo.',
      ],
      pt: [
        'Abra Configurações → Backup (exige PIN de Administrador).',
        'Clique em Exportar para baixar um arquivo JSON de backup.',
        'Guarde o arquivo em local seguro (USB, nuvem).',
        'Para restaurar, clique em Importar e selecione um arquivo de backup.',
      ],
    },
    warnings: {
      en: [
        'Import only ADDS records that do not already exist (matched by id). It never overwrites or deletes existing data.',
        'Export regularly. Local storage is finite — if it fills up, new saves can fail.',
      ],
      es: [
        'Importar solo AGREGA registros que aún no existen (por id). Nunca sobrescribe ni borra datos existentes.',
        'Exporta con frecuencia. El almacenamiento local es limitado — si se llena, los nuevos guardados pueden fallar.',
      ],
      pt: [
        'Importar apenas ADICIONA registros que ainda não existem (por id). Nunca sobrescreve nem apaga dados existentes.',
        'Exporte com frequência. O armazenamento local é finito — se encher, novos salvamentos podem falhar.',
      ],
    },
    troubleshooting: {
      en: ['Import did nothing? The records may already exist — import skips duplicates by id.'],
      es: ['¿La importación no hizo nada? Los registros quizá ya existen — la importación omite duplicados por id.'],
      pt: ['A importação não fez nada? Os registros podem já existir — a importação ignora duplicados por id.'],
    },
    related: ['settings'],
  },

  // ── Intelligence / AI Assistant ───────────────────────────
  {
    id: 'intelligence',
    icon: '🧠',
    title: { en: 'Intelligence / AI Assistant', es: 'Intelligence / Asistente IA', pt: 'Intelligence / Assistente IA' },
    summary: {
      en: 'Ask the store operator brain questions and get deterministic answers.',
      es: 'Hazle preguntas al cerebro operador de la tienda y obtén respuestas deterministas.',
      pt: 'Faça perguntas ao cérebro operador da loja e receba respostas determinísticas.',
    },
    whatItDoes: {
      en: 'Intelligence acts as a store operator: ask about today\'s sales, who to contact, what is losing money, or what to restock. Answers are computed deterministically from your own data — no guessing, no invented numbers. Follow-up phrases like "why?" or "contact him" re-use the last context.',
      es: 'Intelligence actúa como operador de la tienda: pregunta por las ventas de hoy, a quién contactar, qué está perdiendo dinero o qué reabastecer. Las respuestas se calculan de forma determinista con tus propios datos — sin adivinar, sin números inventados. Frases de seguimiento como "¿por qué?" o "contáctalo" reutilizan el último contexto.',
      pt: 'Intelligence atua como operador da loja: pergunte sobre as vendas de hoje, quem contatar, o que está perdendo dinheiro ou o que repor. As respostas são calculadas de forma determinística com seus próprios dados — sem adivinhação, sem números inventados. Frases de acompanhamento como "por quê?" ou "contate ele" reutilizam o último contexto.',
    },
    commonActions: {
      en: ['Ask an operational question', 'Use a quick-action chip', 'Follow up with "why?" or "show more"', 'Review suggested opportunities'],
      es: ['Hacer una pregunta operativa', 'Usar un chip de acción rápida', 'Dar seguimiento con "¿por qué?" o "ver más"', 'Revisar oportunidades sugeridas'],
      pt: ['Fazer uma pergunta operacional', 'Usar um atalho de ação rápida', 'Acompanhar com "por quê?" ou "ver mais"', 'Revisar oportunidades sugeridas'],
    },
    steps: {
      en: [
        'Open Intelligence (Admin PIN required) or the floating assistant.',
        'Type a question like "best customer" or "what should I do today".',
        'Read the answer and any suggested action buttons.',
        'Ask a short follow-up to dig deeper into the same topic.',
      ],
      es: [
        'Abre Intelligence (requiere PIN de Administrador) o el asistente flotante.',
        'Escribe una pregunta como "mejor cliente" o "qué hago hoy".',
        'Lee la respuesta y los botones de acción sugeridos.',
        'Haz un seguimiento corto para profundizar en el mismo tema.',
      ],
      pt: [
        'Abra Intelligence (exige PIN de Administrador) ou o assistente flutuante.',
        'Digite uma pergunta como "melhor cliente" ou "o que fazer hoje".',
        'Leia a resposta e os botões de ação sugeridos.',
        'Faça um acompanhamento curto para se aprofundar no mesmo tema.',
      ],
    },
    warnings: {
      en: [
        'Suggestions are never executed automatically. You approve every action.',
        'Follow-up context expires after a while — if it is stale, ask the full question again.',
      ],
      es: [
        'Las sugerencias nunca se ejecutan automáticamente. Tú apruebas cada acción.',
        'El contexto de seguimiento expira tras un rato — si está viejo, vuelve a hacer la pregunta completa.',
      ],
      pt: [
        'As sugestões nunca são executadas automaticamente. Você aprova cada ação.',
        'O contexto de acompanhamento expira após um tempo — se estiver velho, refaça a pergunta completa.',
      ],
    },
    troubleshooting: {
      en: ['Got a generic answer? Rephrase with a clear operational phrase like "show unpaid repairs" or "best customer".'],
      es: ['¿Respuesta genérica? Reformula con una frase operativa clara como "reparaciones sin pagar" o "mejor cliente".'],
      pt: ['Resposta genérica? Reformule com uma frase operacional clara como "reparos não pagos" ou "melhor cliente".'],
    },
    related: ['customers', 'reports', 'inventory'],
  },
];

/** Lookup helper used by HelpModule for related-module chips. */
export function getHelpModule(id: string): HelpModuleEntry | undefined {
  return HELP_MODULES.find((m) => m.id === id);
}
