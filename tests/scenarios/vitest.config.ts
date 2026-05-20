import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const financeAgentSrc = resolve(__dirname, '../../services/finance-agent/src');

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
      // Orchestrator-agent generic rule (covers ConflictAnalyzer, CompromiseGenerator, services)
      { find: '@', replacement: resolve(__dirname, '../../services/orchestrator-agent/src') },
      { find: '@itinera/shared', replacement: resolve(__dirname, '../../services/shared/src') },
    ],
  },
});
