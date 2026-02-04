export interface RachaSocialItem {
  id?: number;
  nome: string;
  email: string;

  // Dados de quem gastou
  gastou: boolean;
  valorGasto: number | null;

  // Dados de quem vai pagar
  pagar: boolean;
  qtdeAdultos: number | null;
  qtdeCriancas: number | null;
  percentualCriancas: number | null; // Padrão 50%

  // Calculados (Simulados, pois a lógica de cálculo não estava nos arquivos enviados)
  haReceber: number;
  haPagar: number;
}
