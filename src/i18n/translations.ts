import type { TranslationDictionary } from './types';

/**
 * Master translation dictionary.
 * Convention: keys use dot-notation by domain.
 * e.g. 'common.save', 'common.cancel', 'pos.checkout'
 *
 * For interpolation, use a function:
 *   tax_rate: { en: (r: string) => `Tax (${r}%)`, ... }
 *
 * Start with ~25 common keys as proof-of-concept.
 * Future rounds migrate module-by-module from es? ternaries.
 */
export const translations: TranslationDictionary = {
  // ── Common actions ──
  'common.save':      { en: 'Save',       es: 'Guardar',     pt: 'Salvar' },
  'common.cancel':    { en: 'Cancel',     es: 'Cancelar',    pt: 'Cancelar' },
  'common.delete':    { en: 'Delete',     es: 'Eliminar',    pt: 'Excluir' },
  'common.edit':      { en: 'Edit',       es: 'Editar',      pt: 'Editar' },
  'common.close':     { en: 'Close',      es: 'Cerrar',      pt: 'Fechar' },
  'common.search':    { en: 'Search',     es: 'Buscar',      pt: 'Buscar' },
  'common.add':       { en: 'Add',        es: 'Agregar',     pt: 'Adicionar' },
  'common.back':      { en: 'Back',       es: 'Regresar',    pt: 'Voltar' },
  'common.confirm':   { en: 'Confirm',    es: 'Confirmar',   pt: 'Confirmar' },
  'common.print':     { en: 'Print',      es: 'Imprimir',    pt: 'Imprimir' },
  'common.loading':   { en: 'Loading...', es: 'Cargando...', pt: 'Carregando...' },
  'common.error':     { en: 'Error',      es: 'Error',       pt: 'Erro' },
  'common.success':   { en: 'Success',    es: 'Éxito',       pt: 'Sucesso' },
  'common.yes':       { en: 'Yes',        es: 'Sí',          pt: 'Sim' },
  'common.no':        { en: 'No',         es: 'No',          pt: 'Não' },
  'common.none':      { en: 'None',       es: 'Ninguno',     pt: 'Nenhum' },
  'common.total':     { en: 'Total',      es: 'Total',       pt: 'Total' },
  'common.subtotal':  { en: 'Subtotal',   es: 'Subtotal',    pt: 'Subtotal' },
  'common.date':      { en: 'Date',       es: 'Fecha',       pt: 'Data' },
  'common.status':    { en: 'Status',     es: 'Estado',      pt: 'Status' },

  // ── Common labels ──
  'common.customer':  { en: 'Customer',   es: 'Cliente',     pt: 'Cliente' },
  'common.phone':     { en: 'Phone',      es: 'Teléfono',    pt: 'Telefone' },
  'common.email':     { en: 'Email',      es: 'Correo',      pt: 'E-mail' },
  'common.name':      { en: 'Name',       es: 'Nombre',      pt: 'Nome' },
  'common.notes':     { en: 'Notes',      es: 'Notas',       pt: 'Notas' },

  // ── Interpolation example ──
  'common.tax_rate':  {
    en: (rate: string) => `Tax (${rate}%)`,
    es: (rate: string) => `Impuesto (${rate}%)`,
    pt: (rate: string) => `Imposto (${rate}%)`,
  },

  // ── Toast messages (bilingual pattern) ──
  'toast.saved':      { en: 'Saved successfully',    es: 'Guardado con éxito',       pt: 'Salvo com sucesso' },
  'toast.deleted':    { en: 'Deleted successfully',   es: 'Eliminado con éxito',      pt: 'Excluído com sucesso' },
  'toast.error':      { en: 'Something went wrong',   es: 'Algo salió mal',           pt: 'Algo deu errado' },
};
