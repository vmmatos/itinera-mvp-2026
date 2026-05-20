import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const financeAgentSrc = resolve(__dirname, '../../services/finance-agent/src');
const logisticsAgentSrc = resolve(__dirname, '../../services/logistics-agent/src');

export default defineConfig({
  test: {
    silent: true,
  },
  resolve: {
    alias: [
      // Finance-agent internal @/ imports — must precede the generic @/ rule
      { find: '@/agents/BaseFinanceAgent', replacement: `${financeAgentSrc}/agents/BaseFinanceAgent` },
      { find: '@/agents/CostCalculator', replacement: `${financeAgentSrc}/agents/CostCalculator` },
      { find: '@/agents/BudgetValidator', replacement: `${financeAgentSrc}/agents/BudgetValidator` },
      // Logistics-agent internal @/ imports — must precede the generic @/ rule
      { find: '@/agents/BaseLogisticsAgent', replacement: `${logisticsAgentSrc}/agents/BaseLogisticsAgent` },
      // Orchestrator-agent generic rule (covers ConflictAnalyzer, CompromiseGenerator, services)
      { find: '@', replacement: resolve(__dirname, '../../services/orchestrator-agent/src') },
      { find: '@itinera/shared', replacement: resolve(__dirname, '../../services/shared/src') },
    ],
  },
});
