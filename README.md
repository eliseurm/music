# 🎼 Visualizador de Partituras MuseScore/XML com Trombone Helper

Um projeto web interativo que carrega e exibe partituras a partir de arquivos MuseScore/XML (.mscx, .xml), com funcionalidades específicas para músicos de trombone.

## ✨ Funcionalidades

### 📁 Carregamento de Arquivos
- **Arquivos locais**: Selecione arquivos do seu computador
- **Google Drive**: Acesse arquivos diretamente do seu Google Drive
- Suporte para formatos: `.mscx`, `.xml` (MuseScore/XML)

### 🎵 Visualização de Partitura
- Exibição interativa da partitura usando **VexFlow**
- Interface responsiva para desktop, tablet e celular
- Zoom in/out para melhor visualização

### 🎷 Ferramentas para Trombone
- **Posições da vara**: Visualize as posições do trombone para cada nota
- **Alternador de claves**: Mude entre clave de sol e clave de fá
- **Dicionário de posições**: Referência rápida das posições do trombone

### 🎼 Funcionalidades Musicais
- **Transporte de tonalidade**: Alterne entre diferentes tonalidades

## 🚀 Como Usar

### 1. Carregar uma Partitura
- **Do computador**: Clique em "Escolher Arquivo" e selecione um arquivo .mscx ou .xml
- **Do Google Drive**: Clique em "Google Drive" e autorize o acesso aos seus arquivos

### 2. Navegar pela Partitura
- Use as setas para navegar entre as páginas
- Ajuste o zoom com os botões "+" e "-"
- Role para cima/baixo em dispositivos móveis

### 3. Usar as Ferramentas do Trombone
- Ative/desative a exibição das posições com o botão "Posições do Trombone"
- Consulte o dicionário de posições para referência
- Alterne entre claves conforme necessário

## 🛠️ Tecnologias Utilizadas

- **HTML5/CSS3/JavaScript** (Vanilla)
- **[VexFlow](https://www.vexflow.com/)** - Renderização de partituras
- **[Google APIs](https://developers.google.com/drive)** - Integração com Google Drive
- **LocalStorage** - Salvar preferências do usuário

## 📱 Compatibilidade

- ✅ Desktop (Chrome, Firefox, Safari, Edge)
- ✅ Tablets (iPad, Android)
- ✅ Celulares (iPhone, Android)
- ✅ Offline (para arquivos locais)

## 🎯 Funcionalidades Específicas do Trombone

### Posições da Vara
- Visualização clara das 7 posições do trombone

### Dicionário de Posições
- Referência visual das notas em cada posição
- Inclui notas fundamentais e harmônicos

## 🔧 Configuração para Desenvolvimento

```bash
# Clone o repositório
git clone [url-do-repositorio]

# Navegue até a pasta do projeto
cd visualizador-partituras-trombone

# Abra o arquivo principal
npm run start
