# JornadaTCG Web

Frontend separado do backend. React + TypeScript + Vite, Node.js 24.

## Desenvolvimento

1. No projeto jornadatcg-api, execute `npm run start:dev` (porta 3000).
2. Neste projeto, execute `npm install` e `npm run dev` (porta 5173).
3. Abra http://localhost:5173.

O proxy de desenvolvimento encaminha /api para localhost:3000. Nenhum token,
segredo ou conexão com banco deve ser colocado no frontend. `VITE_API_BASE_URL`
é público. Em produção configure essa variável com a origem HTTPS da API ou
configure um proxy equivalente; o proxy do Vite só funciona em desenvolvimento.
Quando usar origens separadas, configure AUTH_ALLOWED_ORIGINS no backend.

## Primeira entrega

- Cabeçalho vermelho #b2190b, pesquisa, carrossel manual de banners ativos.
- Destaques e catálogo público com filtros, ordenação e carregar mais.
- Detalhes da carta em modal acessível e estimativa de frete por CEP/quantidade.
- Layout responsivo, estados de carregamento, erro, vazio e imagem ausente.
- Todos os produtos são reais da API; não há catálogo inventado.

Login, renovação de sessão, carrinho, checkout, Pix e consulta de pedidos estão
conectados à API. Compras acumuladas, endereços, solicitação de envio, cotação e
Pix do frete e cadastro de clientes também estão disponíveis. O painel de gestão
já permite administrar produtos, estoque, banners e envios, além de consultar
pedidos e vendas. A central de
notificações reúne os marcos registrados nos pedidos e nas solicitações de envio.

## Verificação

`npm run build` valida TypeScript e gera dist. `npm run lint` executa o lint.
Foi verificado no navegador o carregamento integrado à API local. Apenas um
produto de teste estava disponível, portanto paginação com vários lotes precisa
de dados adicionais para validação integrada. `npm test` executa testes de sessão,
recuperação de compra e componentes com a API simulada.

Fontes são carregadas do Google Fonts com fallback local sans-serif. Imagens das
cartas são servidas pelas URLs fornecidas pela API. Banners usam a origem da API.

## Login e carrinho (segunda entrega)

Cabeçalho com Entrar/Minha conta e Carrinho. O botão Criar conta permite cadastrar
novos clientes antes de entrar. O cookie de refresh
é HttpOnly; o access token fica apenas em memória. O cliente tenta restaurar a
sessão ao abrir a página e renova antes de uma chamada autenticada quando o token
está próximo de expirar, ou após um 401, com uma única repetição. Não há retry
automático de refresh com resposta perdida. Web Locks serializa login, refresh
e logout entre abas em navegadores compatíveis; BroadcastChannel limpa estado
nas demais abas ao trocar ou encerrar uma sessão.

No desenvolvimento o proxy reescreve Path=/auth do cookie para /api/auth.
O backend deve permitir http://localhost:5173 e http://127.0.0.1:5173 em
AUTH_ALLOWED_ORIGINS. Reinicie a API após alterar o .env. Em produção, configure
origens, HTTPS e o caminho de cookie conforme o proxy usado.

O botão + carrinho pede login quando necessário. Depois de entrar, volte à carta
e clique novamente; não há adição escondida durante o login. Quantidades são
somadas ao carrinho consultado na API e enviadas como valores absolutos. O modal
permite aumentar, diminuir ou remover itens; estoque e falhas são exibidos.
Carrinho não reserva estoque; a reserva ocorre ao confirmar o pedido.

Verificação: npm run build, npm run lint, npm test. Testes simulam API e verificam
cookies nas chamadas, deduplicação de refresh, renovação após 401, logout,
login pela interface, quantidade absoluta na adição e remoção.

## Checkout e Pix

Após entrar, adicione cartas, abra Carrinho e escolha Continuar compra. A tela
revisa o total e explica que as compras pagas ficam acumuladas: envio e frete
serão solicitados e pagos separadamente. Confirmar pedido faz `POST /orders`
com `expectedSubtotal` e `Idempotency-Key` UUIDv4. A API confere preço/estoque,
reserva as cartas e esvazia o carrinho. Erros de preço ou estoque pedem uma nova
revisão; não se aceita automaticamente um total diferente.

Uma chave e o subtotal original são guardados em `sessionStorage`, por usuário,
antes da primeira tentativa. Falhas de rede/5xx mantêm essa confirmação para
recuperar o mesmo pedido. Retomar compra funciona mesmo com carrinho vazio após
uma resposta perdida. Nenhum POST é disparado ao abrir a página. Não feche a
aba durante uma tentativa: sessionStorage sobrevive a recargas, mas não garante
recuperação após encerrar a aba ou limpar os dados do navegador. Armazenamento
indisponível/corrompido bloqueia nova confirmação e orienta consultar os pedidos.

O pedido exige uma ação separada para Gerar Pix. A interface aceita CPF com ou
sem pontuação, envia somente os 11 dígitos para a API e informa que o documento
será vinculado ao cadastro. CPF, token e QR não são gravados no armazenamento do
navegador. A cobrança usa `POST /orders/:id/payments/pix`; falha nunca cria outro
pedido automaticamente. QR e código copia e cola vêm da API, com identificação
do ambiente sandbox quando aplicável. A função de copiar usa o clipboard em
contexto seguro (HTTPS ou localhost), com seleção manual como alternativa.

A janela consulta o estado por GET a cada 15 segundos enquanto visível, sem
repetir automaticamente a criação da cobrança. Fechar a janela encerra as
consultas; o pedido pode ser retomado em Minha conta → Meus pedidos. O horário
do navegador apenas oculta um Pix vencido, sem declarar pagamento/cancelamento.
A confirmação é exibida a partir do estado do pedido na API. Fechar/Esc ficam
temporariamente bloqueados durante confirmação ou geração de Pix.

Os testes dessa etapa simulam a API; não criam pedidos ou cobranças no banco real.
Para validar manualmente, mantenha o backend e frontend ligados, use o produto de
teste e confira o ambiente sandbox Asaas antes de emitir o Pix. Depois de pagar
no sandbox, use Atualizar pagamento ou aguarde a consulta automática. Esta etapa
não depende da chave Pokémon/TCGGO e não requer novas variáveis de ambiente.

## Compras acumuladas e envios

Em Minha conta → Compras acumuladas e envios, escolha cartas pagas de um ou mais
pedidos e informe as quantidades. A seleção acompanha a troca de páginas; cada
solicitação aceita até 70 cartas. O resumo da API considera todas as páginas.
Somente as quantidades disponíveis aparecem para seleção; o servidor verifica
novamente a disponibilidade ao confirmar.

Selecione um endereço salvo ou cadastre um novo endereço de entrega. O cadastro
aceita CEP com/sem hífen e UF brasileira; informações pessoais ficam no estado
da tela e no backend, sem serem copiadas para o armazenamento do navegador.
Uma falha ambígua no cadastro pede consultar a lista antes de tentar novamente.
Edição, remoção e escolha do principal estão disponíveis em Minha conta → Meus endereços.

Solicitar envio guarda primeiro uma chave UUID e uma cópia dos IDs/quantidades
em sessionStorage por conta. Essa chave também é o ID da solicitação na API.
Se a resposta se perder, Recupere a solicitação com GET pelo mesmo ID e, apenas
se não existir, reenvie o POST com a mesma chave/corpo. Dados incertos não geram
uma chave nova. Guardam-se somente IDs e quantidades; não há CPF, endereço
completo, token ou QR neste armazenamento. Como no checkout, encerrar a aba ou
limpar os dados pode remover a tentativa; consulte Meus envios antes de repetir.

Na solicitação criada, Calcular frete consulta as opções dos provedores
configurados no backend. Escolher confirma uma cotação, e só depois o CPF e o
botão de Pix autorizam a cobrança separada. Reabrir detalhes executa GETs: não
recota, não escolhe um serviço e não gera cobrança automaticamente. Recalcular
invalida o lote/seleção anterior; a tela pausa ações se uma mutação precisar ser
reconciliada. Cotações expiradas exigem novo cálculo. Sem cotação o valor é
exibido como A calcular, sem apresentar o zero do banco como frete grátis.

O pagamento do frete reaproveita o contrato Pix e consulta por GET a cada
15 segundos enquanto a janela está visível. Cobranças já existentes bloqueiam
novas cotações/seleções. Uma intenção ainda não concluída pode ser retomada por
ação explícita para o mesmo envio; não há repetição automática de POST. O
relógio local apenas oculta um QR vencido. Confirmação do frete, preparação,
postagem, rastreio e entrega são apresentados conforme a API.

Meus envios lista solicitações existentes. O cancelamento exige confirmação e
só é oferecido quando a consulta de pagamento confirma ausência de cobrança
ativa e o envio ainda está pendente; o backend decide se é permitido e libera
as cartas quando cancelar. Botões de navegação/fechar ficam bloqueados durante
cadastro, confirmação, cotação, seleção e criação de cobrança em andamento.

Validação local: backend ligado na porta 3000, frontend na 5173, conta com cartas
pagas e provedor de frete configurado. Use os ambientes sandbox já configurados
para Melhor Envio e Asaas. Não há nova variável de ambiente no frontend; a chave
TCGGO não é necessária para operar compras já cadastradas. Testes automatizados
usam a API simulada e não criam envios ou cobranças reais.

## Cadastro de clientes

Em Entrar → Criar conta, informe nome, e-mail, senha e confirmação. Nome aceita
até 120 caracteres, e-mail até 254 e senha entre 12 e 128, conforme o backend.
As senhas devem coincidir e não podem conter somente espaços. Não há exigência
adicional de símbolos, números ou maiúsculas. O botão Mostrar senhas permite
conferir os dois campos. Mensagens de validação estão associadas aos campos.

O formulário envia somente `{name,email,password}` para `POST /auth/register`.
Remove espaços nas pontas de nome/e-mail, normaliza e-mail para minúsculas e
preserva a senha exatamente como digitada. A confirmação fica apenas na tela.
O cadastro não exige credenciais existentes e não cria sessão: após HTTP 201 e
um perfil válido, volta ao login com o e-mail preenchido e a confirmação de
conta criada. A senha deve ser informada novamente para entrar e usar o carrinho.

Durante o cadastro, envio duplicado, troca de painel e fechamento do modal ficam
bloqueados. As senhas são limpas após a tentativa ou ao sair da tela e não são
gravadas em storage. Erros 400, 409 e 429 apresentam orientações; `Retry-After`
define a espera para uma nova tentativa. O tempo máximo de espera é de 15
segundos. Falhas de rede, timeout, 5xx e respostas inválidas não repetem o POST:
a conta pode ter sido criada. A tela oferece tentar entrar com o mesmo e-mail
ou revisar o cadastro antes de uma nova tentativa explícita.

Os testes de helper, componente e integração com o modal usam API simulada.
Para verificar localmente, mantenha a API e o frontend ligados, abra Entrar →
Criar conta e use um e-mail de teste ainda não cadastrado. Após a confirmação,
entre com a senha escolhida e confira o carrinho. Nenhuma variável nova de
ambiente ou chave TCGGO é necessária nesta etapa.

## Gestão de produtos e estoque

Entre com uma conta ADMIN e abra Minha conta → Gestão de produtos. Contas de
clientes não exibem essa entrada; a API também exige ADMIN em todas as rotas de
produtos. A interface não promove contas nem altera permissões. Use o procedimento
de primeiro administrador documentado no backend, se necessário.

O painel lista anúncios ativos/inativos, filtra pelo nome da carta e pagina os
resultados. Gerenciar consulta novamente o produto antes de exibir seus dados.
Novo produto permite escolher uma carta do catálogo local, categoria, condição,
idioma, preço, estoque inicial, observação e destaque. A seleção da carta é
explícita, com pesquisa e paginação. As opções devem estar cadastradas na API.
Pesquisa e importação de cartas estão em Minha conta → Biblioteca de cartas. As categorias, condições
e idiomas podem ser cadastrados em Minha conta → Cadastros da loja.

Preço aceita `25,90` ou `25.90` e é enviado como texto decimal `25.90`, sem
arredondamento. A edição envia somente os campos alterados; a carta vinculada
permanece a mesma. Ativar/desativar, marcar destaque e ordenar os destaques usam
os campos já existentes. O catálogo e os destaques da mesma página são
reconsultados após uma alteração confirmada.

O ajuste de estoque é separado da edição do anúncio. A tela mostra disponíveis,
reservadas e vendidas; somente disponíveis podem ser ajustadas. Revisar estoque
apresenta a quantidade anterior e a nova antes de Confirmar estoque. O PATCH
envia `expectedAvailableQuantity` conforme a última consulta. Se uma compra ou
outra operação mudar o estoque, HTTP 409 bloqueia novos ajustes até Atualizar
produto e uma nova revisão. Produto legado sem estoque não assume zero.

Escritas têm limite de espera de 15 segundos e não são repetidas automaticamente
após falha de rede/timeout. Erro ao editar ou ajustar estoque exige atualizar o
produto. Antes de criar, sessionStorage guarda somente o ID da carta por conta.
Uma resposta incerta bloqueia outro cadastro até Conferir anúncios da carta e
Liberar novo cadastro por ação explícita, após revisar a lista. A API permite
múltiplos anúncios da mesma carta e não fornece idempotência para esse POST;
essa proteção é local à aba e pode se perder ao fechar a aba/limpar o navegador.
Consulte os anúncios existentes antes de repetir uma criação em outra aba.

Enquanto salva, a interface bloqueia fechamento, navegação e submissões
duplicadas. Leituras antigas são descartadas se a sessão/painel mudar, e uma
resposta 403 interrompe o acesso. O backend continua decidindo a autorização e
a validade dos dados. Não há nova variável de ambiente, migration ou chave
externa necessária para administrar produtos de cartas já importadas.

Para validar, use uma conta ADMIN e os produtos de teste: filtre a lista, abra
Gerenciar, altere preço/destaque e confira a vitrine. Depois revise um ajuste
de estoque e confirme. Os testes automatizados e a prévia visual usam API
simulada; não alteram produtos nem estoque reais.

## Gestão de banners

Com uma conta ADMIN, abra Minha conta → Gestão de banners. O painel permite
cadastrar, editar título/link/ordem, ativar/desativar e trocar a imagem. Banners
novos começam inativos; marque Banner ativo quando quiser publicar. A loja
atualiza sua consulta de banners após uma gravação confirmada na mesma página.

Prepare uma imagem estática de **1600 × 500 pixels**, PNG, JPEG ou WebP, de até
**5 MB**. O formulário verifica tipo declarado, tamanho e dimensões antes do
upload. O backend verifica o formato real, rejeita animações e converte para
WebP. A confirmação final é sempre da API. O título funciona como texto
alternativo; links aceitam somente caminhos internos, como `/#catalogo` (não
links externos ou caminhos codificados). Menores valores de ordem aparecem
primeiro, com o ID como desempate.

Cadastro usa FormData com image, title, link, active e sortOrder. O navegador
define o Content-Type e o boundary do upload. Edição envia somente os metadados
alterados. Trocar imagem usa outro formulário e pede revisar antes de confirmar;
esse envio contém somente image e preserva os demais campos. Para retirar um
banner da loja, desmarque Banner ativo. Não há exclusão permanente nesta tela.

Imagens administrativas, inclusive inativas, são consultadas com Bearer em
`GET /admin/banners/:id/image`, exibidas por URLs locais temporárias e liberadas
ao trocar a imagem, página ou sessão. O painel não usa imageUrl público nem
coloca tokens em URLs. A lista consulta até 100 registros e exibe seis por
página para limitar o carregamento de prévias; a vitrine publica até 20 ativos.

Durante gravações, envio duplicado, fechamento e troca de painel ficam
bloqueados. O tempo máximo de espera é 15 segundos; rede, timeout e resposta
inválida não repetem o upload automaticamente. Edições incertas exigem Atualizar
banners. Antes de cadastrar, a aba guarda apenas o título em sessionStorage por
conta. Uma resposta incerta bloqueia outro cadastro até Revisar cadastros e
Liberar novo cadastro por ação explícita, após a conferência. Títulos não são
únicos na API; a consulta não prova que um cadastro não existe. A proteção é
local à aba e pode se perder ao fechá-la/limpar os dados. Consulte os banners
existentes antes de repetir uma criação em outra aba.

Para testar localmente, abra a gestão com a API/frontend ligados, envie uma
imagem no padrão acima e salve inicialmente inativo. Confira a prévia, edite a
ordem/link, ative e observe o carrossel da loja. Testes e prévia visual do
desenvolvimento usam API simulada; não enviam arquivos nem modificam banners
reais. Nenhuma variável nova de ambiente ou chave Pokémon é necessária.

## Gestão administrativa de envios

Entre com uma conta ADMIN e abra Minha conta → Gestão de envios. A fila mostra
as solicitações em preparação, prontas para postagem e postadas, com 12 por
página. Abra Gerenciar envio para conferir cartas, endereço, embalagem, serviço,
frete pago, etiqueta e rastreamento. Entregues e cancelados deixam a fila.

A tela usa `GET /admin/shipments` e `GET /admin/shipments/:id`. Antes de emitir,
confira fisicamente as cartas e confirme a embalagem. Em seguida informe os
dados do destinatário, crie a etiqueta, revise e autorize seu custo, solicite a
geração, sincronize e obtenha o link de impressão. Em produção, a compra utiliza
saldo real do Melhor Envio; o sandbox é identificado na tela. A nota fiscal é
obrigatória em produção, conforme as regras da API. Documentos e telefone não
são persistidos pelo frontend e os campos são limpos após a tentativa.

Nenhuma compra, geração ou sincronização é feita ao abrir o painel. Após uma
operação, o detalhe é reconsultado. Falhas ou timeout bloqueiam novas operações
até Atualizar envio. Uma tentativa já registrada pelo servidor não habilita
nova compra ou geração: use Sincronizar etiqueta. Se a criação tiver resultado
incerto, confira o painel do Melhor Envio e recupere a mesma etiqueta pelo UUID.
Não crie outra. O servidor continua aplicando autorização e regras financeiras.

Durante operações, envio duplicado, fechamento e troca de painel ficam
bloqueados. Consultas e operações têm limite de espera de 15 segundos; não há
repetição automática após timeout. A impressão aceita apenas HTTPS do domínio
Melhor Envio do ambiente da etiqueta. Postagem e entrega vêm da sincronização
existente com o provedor, sem marcação manual.

Para testar, use um envio sandbox com frete pago e siga as etapas acima.
Build, testes e prévia visual do desenvolvimento usam simulações, sem comprar
etiquetas reais. Nenhuma variável nova ou migration é necessária; as credenciais
de frete, remetente e pagamento já existentes continuam sendo usadas pela API.

## Notificações de pedidos e envios

Abra o sino Notificações no cabeçalho ou Minha conta → Notificações após entrar.
A central usa `GET /notifications?limit=20`, com autenticação e `no-store`, para
mostrar os marcos das suas compras: pedido criado, pagamento confirmado,
cancelamento do pedido, envio solicitado, frete pago, embalagem conferida,
postagem e entrega. São fatos históricos das datas existentes no banco; não
representam necessariamente o estado atual. Abra Ver pedido ou Ver envio para
consultar a situação e as opções disponíveis naquele momento.

Carregar mais notificações usa o cursor opaco da API. Atualizar notificações
reinicia a consulta para incluir marcos novos ou recebidos com atraso do provedor.
A lista remove duplicatas entre páginas. Não há consulta periódica, marcação
de lidas/não lidas, contador de pendências, e-mail ou push nesta etapa. Nenhum
dado da central é persistido no armazenamento do navegador.

Abrir um pedido primeiro consulta seu ID autenticado; abrir um envio passa o ID
para a tela existente, que consulta o detalhe e a cobrança. Essas ações não
criam pedido, Pix, envio ou etiqueta. No pedido, uma leitura de cobrança pode
reconciliar um pagamento existente, como no fluxo de checkout já implementado.
Todas as operações de compra continuam dependendo de ação explícita. Uma
tentativa de compra ou envio previamente salva na aba é preservada.

O carregamento das notificações e a leitura inicial do pedido têm prazo de 15
segundos. Falhas exibem mensagem fixa e permitem tentar novamente. Durante a
abertura do pedido, fechamento e troca de painel ficam bloqueados; logout ou
troca de conta abortam a consulta e descartam respostas tardias. A autorização
do servidor continua limitando cada consulta à conta autenticada.

Para validar, mantenha API e frontend ligados, entre e abra Notificações. Use os
pedidos/envios sandbox existentes para conferir os marcos e abrir os detalhes.
A prévia e os testes automatizados usam dados simulados, sem cobranças reais.
Não há nova chave, variável de ambiente ou migration para esta integração.

## Meus endereços

Entre e abra Minha conta → Meus endereços. A área permite consultar, cadastrar,
editar, escolher o endereço principal e remover endereços da sua própria conta.
Usa as rotas existentes `GET /addresses`, `GET /addresses/:id`, `POST /addresses`,
`PUT /addresses/:id` e `DELETE /addresses/:id`, com autenticação.

Cada conta aceita até 20 endereços. O primeiro se torna principal automaticamente.
Para mudar o principal, escolha outro endereço; a API não permite desmarcar o
principal atual sem substituí-lo. Ao removê-lo, o servidor escolhe o endereço
restante mais antigo. A tela reconsulta a lista após gravar para refletir essa
decisão. É permitido remover o último endereço e cadastrar outro depois.

Editar ou remover um endereço afeta as próximas solicitações de envio. Envios
já criados preservam o endereço registrado na solicitação, inclusive quando
o cadastro original foi alterado ou removido. Não use esta tela para corrigir
o destino de um envio em andamento.

Antes de editar ou remover, a tela consulta novamente o endereço. A edição
envia o corpo completo pelo PUT; a API não possui controle de versão do registro,
portanto alterações simultâneas em outras abas podem ser sobrescritas. Confira
os dados na revisão. Remoções exigem confirmação explícita.

Durante gravações, fechamento e navegação ficam bloqueados. Falhas ou timeout
não repetem escritas automaticamente: atualize e confira a lista antes de tentar
outra alteração. Se um cadastro tiver resultado incerto, revise a lista e confirme
a conferência antes de cadastrar novamente. Essa proteção vale para a montagem
atual da tela; ao reabrir ou usar outra aba, confira os endereços existentes antes
de repetir. Nenhum endereço é gravado no armazenamento do navegador.

Consultas e gravações têm prazo de 15 segundos, erros com mensagens fixas e
descarte de respostas antigas após troca de conta ou encerramento da tela. Os
testes e a prévia visual usam dados simulados. Para validar com sua API, entre,
cadastre um endereço de teste, edite, altere o principal e confira a remoção.
Não há nova variável de ambiente, chave externa ou migration nesta etapa.

## Cadastros da loja

Com uma conta ADMIN, abra Minha conta → Cadastros da loja. As abas Categorias,
Condições e Idiomas mostram as opções ativas disponíveis para os anúncios.
Pesquise pelo nome ou identificador; a paginação é local, sobre a lista retornada
por `GET /products/options`. Reabrir Gestão de produtos consulta novamente essas
opções para criar ou editar um anúncio.

Use o formulário de cadastro da aba desejada. Categoria pede nome e identificador
de até 100 caracteres, como `cartas-avulsas`; aceita letras minúsculas, números
e hífens entre palavras. Condição e idioma pedem um código de até 20 caracteres,
como `NM` ou `PT-BR`, normalizado para maiúsculas. Nomes aceitam até 120
caracteres. Categoria e condição têm descrição opcional de até 2000 caracteres.
Idioma não envia descrição.

O nome e o identificador da categoria são únicos; condições e idiomas usam
códigos únicos. Um conflito também pode vir de uma opção inativa, que não aparece
na consulta. Não crie outro código para contornar um resultado incerto sem antes
conferir os cadastros. A API só oferece criação e consulta nesta etapa; edição,
desativação e exclusão dessas opções não estão nesta tela.

Os formulários usam os endpoints existentes `POST /products/categories`,
`POST /products/conditions` e `POST /products/languages`, enviando somente os
campos de cada tipo. As opções novas começam ativas. Após a criação, o painel
consulta a lista canônica e avisa a vitrine para atualizar os filtros na mesma
página. Não cria produtos nem altera estoque ou preço automaticamente.

Consultas e gravações têm prazo de 15 segundos. Não há repetição automática de
cadastro após falhas. Em resultado incerto, atualize e confira a lista antes de
liberar uma nova tentativa. Dados e estado do formulário ficam apenas na memória
da tela. Durante a gravação, fechamento e navegação ficam bloqueados; troca de
conta ou revogação ADMIN descarta o painel e respostas antigas.

Para testar, use uma conta ADMIN, consulte as três abas e cadastre uma opção de
teste em cada uma. Reabra Gestão de produtos e confira as opções no formulário
de anúncio. Os testes automatizados e a prévia usam API simulada. Não há nova
variável de ambiente, chave Pokémon ou migration para esta integração.

## Biblioteca de cartas

Com uma conta ADMIN, abra Minha conta → Biblioteca de cartas. A aba Cartas
cadastradas consulta `GET /cards` com pesquisa por nome e páginas de 12 cartas.
Ver detalhes consulta `GET /cards/:id`; a biblioteca continua disponível sem a
chave da API Pokémon e mantém as cartas importadas de provedores anteriores.

Na aba Pesquisar na API, informe nome, código como `025/182`, ou ambos. O primeiro
número é o número da carta e o segundo é o total impresso da coleção; números de
cartas secretas podem superar esse total. A pesquisa só ocorre ao enviar o
formulário, usando `GET /cards/search`. Não há consultas por tecla nem pesquisa
automática ao abrir a aba. Pesquisas muito amplas podem ser recusadas; use um nome
mais específico ou combine nome e código. A paginação dos resultados externos é local.

Revise a carta e clique em Importar carta. A requisição `POST /cards/import`
envia somente o `externalId` selecionado; os dados são consultados e validados
pelo backend. A importação adiciona a carta e a coleção à biblioteca e não cria
anúncio, preço ou estoque. Depois, abra Gestão de produtos para criar o anúncio
com uma carta já cadastrada.

Não há importação automática ou repetição após falha. Se o resultado for incerto,
a tela mantém a mesma carta para uma tentativa explícita de verificar ou retomar
a importação. A API reutiliza o cadastro existente para o mesmo identificador,
sem criar uma segunda carta ou sobrescrever seus dados. Um conflito de coleção
e número exige conferir as cartas locais. Trocar de conta ou perder a função
ADMIN descarta as respostas antigas; fechar e navegar ficam bloqueados durante
a importação. Rascunhos e resultados ficam apenas na memória da tela.

As chamadas têm prazo de 15 segundos e mensagens de erro fixas. Imagens ausentes,
inválidas ou indisponíveis têm alternativa visual. A consulta externa e a
importação de cartas novas dependem da configuração TCGGO/RapidAPI já existente
no `.env` do backend; nenhuma chave deve ser colocada no frontend. Falhas de
configuração, cota ou provedor não impedem a consulta das cartas locais.

Validação automatizada e visual com API simulada. Em 08/11/2026, foram validadas
pesquisas reais por nome e nome/código, consulta de detalhes e importação pelo
painel autenticado. Pikachu VMAX, número 44/185, da coleção Vivid Voltage
(`tcggo_6161`, coleção `tcggo_43`), foi gravado na biblioteca. Repetir a importação
pelo painel manteve os mesmos IDs, dados e quantidades de cartas/coleções.
Os produtos, preços, saldos e movimentos de estoque existentes permaneceram iguais;
a carta importada não recebeu anúncio nem estoque neste teste.
Não há nova variável de ambiente nem migration nesta integração.

## Cancelamento de pedidos pendentes

Em Minha conta → Meus pedidos, os pedidos que aguardam pagamento oferecem
Verificar cancelamento do pedido. Essa ação consulta novamente o pedido e seu
histórico completo de pagamentos, usando `GET /orders/:id` e
`GET /orders/:id/payments`. A consulta não depende da configuração Asaas e não
cria nem reconcilia cobranças no provedor.

A confirmação apresenta as cartas, quantidades e total do pedido. O botão
Confirmar cancelamento só fica disponível quando o pedido continua pendente e
nenhum pagamento está pendente, pago ou reembolsado. Uma falha ao consultar o
histórico bloqueia a confirmação. O prazo de pagamento exibido no navegador
não determina se o pedido pode ser cancelado.

Somente a confirmação explícita envia `POST /orders/:id/cancel`, sem corpo ou
chave adicional. A API verifica novamente estado e pagamentos, cancela o pedido
e libera a reserva de estoque na mesma transação. O carrinho não é preenchido
novamente; para uma nova compra, adicione os itens desejados ao carrinho. Pedidos
pagos não usam este fluxo de cancelamento.

Durante a gravação, fechamento, navegação e envio duplicado ficam bloqueados.
Após conflito, timeout ou falha, não há repetição automática do POST nem
confirmação local de cancelamento: Atualizar situação do pedido faz apenas
consultas do mesmo pedido antes de permitir outra revisão. Uma resposta antiga
de outra sessão não altera o painel ou libera uma operação atual.

O histórico mantém Carregar mais pedidos, permite atualização e preserva os
pedidos já carregados quando a próxima página falha. Após o cancelamento
confirmado, a lista mostra a situação retornada pela API e avisa a vitrine para
atualizar a disponibilidade. Dados de revisão ficam apenas na memória da tela.
Consultas e gravações têm prazo de 15 segundos e erros com mensagens fixas.

Os testes e a prévia visual usam pedidos e pagamentos simulados; não cancelam
compras reais. Para validar com sua API, use um pedido de teste sem cobrança
ativa e confira a liberação da reserva. Nenhuma variável de ambiente, chave
Pokémon ou migration nova é necessária nesta etapa.

## Recuperação de senha

Em Entrar → Esqueci minha senha, informe o e-mail da conta. O formulário usa
`POST /auth/forgot-password` e apresenta a mesma confirmação para contas
cadastradas e não cadastradas. Não há chamada automática ao abrir a tela nem
repetição após falhas. A entrega depende da configuração SMTP no backend.

O link enviado pelo backend contém `#reset-password=...`. Ao abrir, o frontend
remove o fragmento da barra de endereço antes de renderizar e mantém o token
apenas na memória da tela. Links malformados ou com parâmetros repetidos são
recusados. Não há token em storage, logs, query de requisições ou resposta da API.
O site e as chamadas de recuperação usam política de referência no-referrer;
requisições públicas não incluem cookies e recusam redirecionamentos.

Na tela de nova senha, informe e confirme uma senha de 12 a 128 caracteres.
Mostrar senhas permite conferir os dois campos. A confirmação envia somente
token e senha para `POST /auth/reset-password`. Senhas não são normalizadas e
são limpas depois da tentativa ou ao sair da tela. Depois do sucesso, o estado
de autenticação local é descartado e o formulário de login mostra a confirmação.
Não há login automático. As sessões anteriores da conta são invalidadas pela API.

Os formulários têm prazo de 15 segundos, limite de espera por Retry-After,
validação acessível e bloqueio de fechamento durante o envio. Resposta incerta
na redefinição pede tentar entrar com a nova senha ou solicitar outro link;
não repete o POST automaticamente. Troca de sessão descarta formulários e
respostas antigas. Recarregar a página após remover o fragmento exige abrir
novamente o link recebido por e-mail.

Para ativar, aplique a migration de recuperação e configure SMTP_HOST, SMTP_PORT,
SMTP_USER, SMTP_PASSWORD, SMTP_FROM e PASSWORD_RESET_URL no `.env` do backend,
conforme seu README. Não há nova variável no frontend. Enquanto o serviço de
e-mail não estiver configurado, a solicitação mostra indisponibilidade.
Testes automatizados e prévia visual usam respostas simuladas, sem envio real.

## Pedidos e vendas

Com uma conta ADMIN, abra Minha conta → Pedidos e vendas. A consulta usa
`GET /admin/orders`, com páginas de 20 pedidos e navegação Anterior/Próxima.
Filtre por situação, número do pedido, nome ou e-mail do cliente e período de
criação. Os campos só iniciam uma consulta ao clicar em Aplicar filtros;
Limpar filtros restaura a primeira página sem filtros. Atualizar pedidos repete
a consulta com os filtros já aplicados, sem aplicar rascunhos do formulário.

As datas usam o horário deste dispositivo e os dois dias informados estão
incluídos no período. O filtro considera a criação do pedido, não o momento do
pagamento. O resumo retornado pela API abrange todos os pedidos que correspondem
aos filtros, incluindo as outras páginas. Vendas confirmadas consideram pedidos
com pagamento confirmado e sem registro de reembolso. Valor das cartas vendidas
é a soma do subtotal das cartas menos os descontos desses pedidos; não inclui
frete. Esse recorte por criação não representa um fluxo de caixa por data de
recebimento.

Ver pedido consulta novamente `GET /admin/orders/:id`. Os detalhes mostram o
cliente, os registros das cartas no momento da compra, quantidades e valores,
pagamentos e envios vinculados. Somente as quantidades deste pedido aparecem
em cada envio. A situação do pedido é exibida conforme a API, sem ser deduzida
da postagem ou entrega de um envio parcial. Sem envio vinculado, as cartas pagas
podem continuar acumuladas. Frete com valor zero ainda não pago aparece como
A calcular.

Ver envio abre os detalhes da solicitação na gestão de envios por GET. Abrir
essa tela não embala, compra ou gera etiqueta, não consulta automaticamente o
provedor e não altera o envio. O painel Pedidos e vendas é somente de consulta:
não cancela pedidos, não altera sua situação e não cria ou reconcilia cobranças.
Ao voltar, a lista é consultada novamente preservando os filtros e a página.
Atualizar pedido permite uma nova consulta explícita do detalhe.

As consultas têm prazo de 15 segundos e mensagens de erro fixas. Troca de sessão
ou fechamento descarta respostas antigas e interrompe consultas pendentes;
respostas 401/403 retiram os dados do painel. Dados do cliente e filtros ficam
somente na memória da tela. Os testes de `admin-orders` e `AdminOrdersArea` usam
a API simulada, sem banco, cobranças ou chamadas a provedores reais. Execute
`npm test -- src/admin-orders.test.ts src/AdminOrdersArea.test.tsx` para validar
essa integração. Nenhuma variável de ambiente nova é necessária no frontend.

## Visão de estoque

Com uma conta ADMIN, abra Minha conta → Visão de estoque. A tela consulta
`GET /admin/inventory`, em páginas de 20 produtos. Filtre por nome da carta,
status do anúncio, situação do estoque e limite de estoque baixo. O limite
inicial é 5 unidades e pode ser alterado no formulário. Aplicar filtros inicia
a consulta; Atualizar estoque repete os filtros aplicados e Limpar filtros
restaura a primeira página e o limite inicial. Digitar não inicia requisições.

O resumo abrange todos os produtos dos filtros, incluindo outras páginas. Baixo
significa de 1 até o limite informado; esgotado significa saldo disponível zero
em estoque cadastrado. Sem cadastro preserva quantidades desconhecidas. Produtos
com reservas podem também estar disponíveis ou esgotados, por isso os indicadores
não são categorias exclusivas. Os saldos aparecem inclusive para anúncios
inativos; use Status do anúncio para restringir a consulta.

Cada produto mostra disponíveis, reservadas, vendidas e a data da atualização
do estoque. Vendidas é o contador acumulado registrado para o produto. Gerenciar
produto abre o cadastro por GET, sem alterar preço ou estoque. Para ajustar,
use a revisão e confirmação já existentes em Gestão de produtos. Voltar aos
produtos nessa tela abre a listagem administrativa geral.

Consultas têm prazo de 15 segundos e erros com mensagens fixas. Mudança de sessão
e fechamento abortam consultas e descartam respostas antigas; 401/403 retiram os
dados da visão. Os filtros ficam somente na memória da tela. Testes e prévia
visual usam dados simulados, sem ajustes em estoque real. Nenhuma nova variável
de ambiente, migration ou chave de serviço é necessária nesta integração.

## Histórico de estoque

Com uma conta ADMIN, abra Minha conta → Histórico de estoque para a consulta
geral. Na Visão de estoque, Ver histórico abre somente as movimentações do
produto escolhido. O cadastro do produto também oferece Ver histórico de
estoque. Abrir o histórico faz apenas consultas e permite fechar o painel.

Os filtros por tipo e período são aplicados explicitamente. Datas incluem os
dois dias no horário do dispositivo. Limpar filtros mantém o escopo do produto;
Ver histórico geral remove o escopo e os demais filtros. A consulta usa
`GET /admin/inventory/movements`, páginas de 20 registros e prazo de 15 segundos.
Respostas antigas são descartadas ao fechar ou trocar a sessão. Erros 401/403
retiram os dados do painel e mensagens brutas da API não são mostradas.

Cada registro apresenta os dados da carta no momento da operação, data, tipo,
responsável quando informado, pedido relacionado, motivo e uma tabela com
disponíveis, reservadas e vendidas antes, variação e depois. Abertura do histórico
identifica os saldos capturados na implantação; não representa operações antigas
reconstruídas. Registros novos passam a ser gerados após aplicar a migration.

O ajuste de estoque no cadastro aceita Motivo do ajuste (opcional), de 3 a 500
caracteres quando preenchido. O motivo aparece na revisão e é enviado somente
após Confirmar estoque. Os campos são limpos após sucesso ou consulta de outro
produto. Nenhum ajuste é repetido automaticamente após falha.

Aplique no backend a migration `20261106090000_inventory_movements` conforme seu
README, com API e workers parados. Sem ela, operações que precisam registrar o
histórico não podem ser concluídas. Não há variável nova no frontend. Testes e
prévia visual usam dados simulados, sem movimentar estoque real.

## Registrar entradas de estoque

Na Gestão de produtos, abra o produto → Estoque → Registrar entrada de estoque.
Informe uma quantidade positiva e um motivo. Revisar entrada apresenta os dados;
somente Confirmar entrada envia o POST. A API soma as unidades disponíveis e
preserva reservas e vendas. Após confirmação, o cadastro é consultado novamente
e o histórico mostra Entrada de estoque com responsável, motivo e saldos.

Antes do envio, o navegador salva a chave e os dados da tentativa em
sessionStorage, separados por administrador/produto. Se houver falha ou espera
excedida, a tentativa é conservada: Verificar entrada consulta o recibo e Reenviar
a mesma entrada usa a mesma chave e dados. Nenhum POST é repetido automaticamente
pelo formulário. A renovação de sessão conserva o mesmo header de idempotência.

Reabrir uma tentativa salva inicia somente uma consulta. Um resultado 404 não
apaga a tentativa, pois a operação original pode ainda estar em andamento.
Falha ou corrupção no armazenamento bloqueia novas entradas; falha ao limpar uma
tentativa já confirmada também impede liberar outra operação. Trocas de conta e
respostas atrasadas não atualizam outro usuário ou produto. Durante o POST,
fechamento e navegação ficam bloqueados como nos ajustes já existentes.

As chamadas usam `POST /products/:id/inventory/entries` e
`GET /products/:id/inventory/entries/:operationKey`, com prazo de 15 segundos.
O motivo é um dado operacional do estoque e não deve conter informações sensíveis.
Aplique a migration de entradas no backend conforme seu README. Nenhuma variável
nova é necessária no frontend.

## Publicação e checks

O workflow .github/workflows/ci.yml prepara checks com Node 24, npm ci, build,
lint e testes. Ele não faz deploy e só executará no GitHub após envio dos arquivos.
Publique dist em uma hospedagem estática HTTPS; o proxy /api do Vite não faz parte
do build. Para usar VITE_API_BASE_URL=/api, configure o proxy equivalente no host,
removendo /api ao encaminhar e reescrevendo Path=/auth do cookie para /api/auth.
Não use o preview do Vite como servidor de produção. Prefira uma origem HTTPS
única para site e API, ou subdomínios do mesmo domínio, para preservar o cookie
SameSite=Strict. A API deve permitir a origem exata em AUTH_ALLOWED_ORIGINS.
O guia completo está em docs/deployment.md no repositório jornadatcg-api.
