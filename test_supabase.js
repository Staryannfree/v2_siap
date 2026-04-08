
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Carrega o .env da raiz do projeto
dotenv.config({ path: 'c:/Users/Adm-Sup/Documents/Github/v2_siap/.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Erro: VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não encontradas no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testConnection() {
  console.log(`Testando conexão com: ${supabaseUrl}`);
  
  try {
    // Tenta fazer um select simples para ver se o endpoint responde
    // Mesmo que o RLS bloqueie os dados, o status da requisição nos dirá se a chave é válida
    const { data, error, status } = await supabase
      .from('professores')
      .select('id')
      .limit(1);

    if (error) {
      console.log('Resposta do Supabase (com erro esperado devido ao RLS ou outro):');
      console.log('Status:', status);
      console.log('Erro:', error.message);
      
      if (status === 200 || status === 401 || status === 403) {
        console.log('\nVEREDITO: Eu tenho acesso ao endpoint, mas o acesso aos dados está protegido (como deveria ser).');
      }
    } else {
      console.log('Conexão bem sucedida!');
      console.log('Dados recebidos (limit 1):', data);
      console.log('\nVEREDITO: Eu tenho acesso ao seu Supabase e consegui ler dados da tabela "professores".');
    }
  } catch (err) {
    console.error('Erro ao conectar:', err.message);
  }
}

testConnection();
