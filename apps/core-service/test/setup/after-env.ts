/**
 * Roda em cada arquivo de teste, antes dos testes.
 *
 * Isolamento: cada teste começa com o banco vazio. Quem precisa de dado, cria
 * pelas factories. Isso torna o teste legível — o que está no arquivo é tudo
 * que existe no banco — e imune à ordem de execução.
 */
import { disconnectTestPrisma, truncateAll } from './db';

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await disconnectTestPrisma();
});
