# PDV Gráfica & Copiadora — estrutura Cloud

Esta versão prepara o PDV para GitHub Pages + Supabase.

## O que já foi preparado

- PWA para GitHub Pages.
- Cliente Supabase incluído.
- `supabase-config.js` para URL/chave pública.
- `supabase_schema.sql` com as tabelas do PDV.
- RLS inicial para exigir usuário autenticado.
- Edge Function `admin-create-user` para criação segura de usuários pelo administrador.
- O PDV continua funcionando localmente até o Supabase ser configurado.

## Próximo passo obrigatório

1. Crie um projeto no Supabase.
2. Abra o SQL Editor e execute `supabase_schema.sql`.
3. Em Project Settings > API, copie a URL do projeto e a chave pública/anon.
4. Preencha `supabase-config.js` e coloque `enabled: true`.
5. Configure o Supabase Auth.
6. Publique estes arquivos no GitHub Pages.

### Importante

Não coloque `service_role` ou qualquer chave secreta no `supabase-config.js`.

A autenticação e as permissões precisam ser concluídas antes de colocar o banco em produção. As policies do SQL desta etapa são uma base de montagem e ainda serão refinadas para que ADMIN e OPERATOR tenham permissões diferentes.

## Estrutura

- `index.html` — PDV/PWA
- `supabase-config.js` — configuração pública do projeto
- `cloud-sync.js` — inicialização da camada cloud
- `supabase_schema.sql` — banco de dados
- `supabase/functions/admin-create-user/index.ts` — criação segura de usuários pelo admin
