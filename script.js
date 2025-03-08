const WebSocket = require('ws');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');

console.log('🚀 Iniciando o servidor...');

// Inicia o WebSocket
const wss = new WebSocket.Server({ port: 8080 });

wss.on('listening', () => {
    console.log('✅ WebSocket está rodando na porta 8080');
});
wss.on('connection', () => {
    console.log('🔗 Cliente WebSocket conectado');
});
wss.on('error', (err) => {
    console.error('❌ Erro no WebSocket:', err);
});

// Redefinir o console.log para enviar as mensagens para os clientes WebSocket
console.log = (message) => {
    // Exibe a mensagem no console do servidor
    process.stdout.write(message + '\n');

    // Envia a mensagem para todos os clientes WebSocket conectados
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'log',
                message: message
            }));
        }
    });
};

// Configurações
const GROUP_NAME = 'PAGAMENTO TESTE (Jorge)';
let groupId = null;
let client;
let isClientConnected = false;

// Função para iniciar o cliente WhatsApp
function startClient() {
    console.log('🚀 Iniciando o cliente do WhatsApp...');
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-extensions',
                '--single-process'
            ]
        }
    });

    // Evento que gera o QR Code
    client.on('qr', qr => {
        if (!isClientConnected) {
            console.log('📌 Escaneie este QR Code:');
            qrcode.generate(qr, { small: true });

            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=150x150`;
                    client.send(JSON.stringify({ type: 'qr', data: qrUrl }));
                }
            });
        }
    });

    // Evento quando o cliente WhatsApp Web está pronto
    client.on('ready', async () => {
        isClientConnected = true;
        console.log('✅ Cliente WhatsApp Web pronto!');
        const chats = await client.getChats();
        const group = chats.find(chat => chat.name === GROUP_NAME);

        if (group) {
            groupId = group.id._serialized;
            console.log(`✅ Grupo "${GROUP_NAME}" encontrado! ID:`, groupId);
        } else {
            console.log(`❌ Grupo "${GROUP_NAME}" não encontrado!`);
        }
    });

    // Evento de mensagem do WhatsApp
    client.on('message', async (msg) => {
        if (msg.id.remote !== groupId) return; // Verifica se a mensagem veio do grupo correto
        console.log(`📩 Nova mensagem no grupo: ${msg.body}`);
    
        // Enviando mensagem para o WebSocket (Frontend)
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'message',
                    message: msg.body
                }));
            }
        });
    
        console.log(`🔎 Tipo da mensagem: ${msg.type}`);
        
        // Se houver mídia ou for um documento
        if (msg.hasMedia || msg.type === 'document' || msg.type === 'image') {
            try {
                console.log('📥 Baixando arquivo...');
                const media = await msg.downloadMedia();
                
                console.log(`🔍 Arquivo recebido (${msg.type}): ${media.mimetype}`);
                
                if (media.mimetype.startsWith('image')) {
                    await processImage(media);
                } else if (media.mimetype === 'application/pdf') {
                    await processPDF(media);
                } else {
                    console.log('⚠️ Tipo de arquivo não suportado:', media.mimetype);
                }
            } catch (err) {
                console.error('❌ Erro ao baixar mídia:', err);
            }
        } else {
            console.log('⚠️ Mensagem não contém mídia.');
        }
    });
    

    // Evento de desconexão do cliente
    client.on('disconnected', async (reason) => {
        isClientConnected = false;
        console.log('⚠️ Cliente desconectado:', reason);
        
        // Emitir para os clientes WebSocket conectados para que o frontend saiba
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'disconnected',
                    message: 'Cliente desconectado. Por favor, escaneie o QR Code novamente.'
                }));
            }
        });
        
        console.log('🛑 Encerrando o Puppeteer antes de reiniciar...');
        
        try {
            await client.destroy();
        } catch (err) {
            console.error('❌ Erro ao destruir o cliente:', err);
        }

        // Reiniciar o cliente após 5 segundos
        console.log('⏳ Aguardando 5 segundos antes de reiniciar...');
        setTimeout(startClient, 5000);
    });

    // Inicialização do cliente
    client.initialize()
        .then(() => console.log('✅ Cliente do WhatsApp inicializado com sucesso!'))
        .catch(err => console.error('❌ Erro ao iniciar o WhatsApp:', err));
}

// Função de processamento de imagem (OCR)
async function processImage(media) {
    console.log('📸 Imagem recebida! Extraindo texto...');
    const buffer = Buffer.from(media.data, 'base64');
    Tesseract.recognize(buffer, 'por')
        .then(({ data: { text } }) => {
            console.log('Texto extraído da imagem:', text);
        })
        .catch(err => console.error('❌ Erro ao processar OCR:', err));
}   

async function processPDF(media) {
    console.log('📄 PDF recebido! Salvando arquivo...');
    const buffer = Buffer.from(media.data, 'base64');
    
    // Obtendo a data e hora atuais
    const currentDate = new Date();
    
    // Nome da pasta (somente a data do dia)
    const folderDate = `${String(currentDate.getDate()).padStart(2, '0')}_${String(currentDate.getMonth() + 1).padStart(2, '0')}_${currentDate.getFullYear()}`;
    const folderPath = path.join('C:', 'Users', 'TELEKIN', 'Desktop', 'COMPROVANTES PARA IMPRIMIR', folderDate);
    
    // Criando a pasta caso não exista
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }

    // Nome do arquivo no formato DD_MM_YYYY_HH_MM_SS.pdf
    const fileDate = `${String(currentDate.getDate()).padStart(2, '0')}_${String(currentDate.getMonth() + 1).padStart(2, '0')}_${currentDate.getFullYear()}_${String(currentDate.getHours()).padStart(2, '0')}_${String(currentDate.getMinutes()).padStart(2, '0')}_${String(currentDate.getSeconds()).padStart(2, '0')}`;
    const fileName = `comprovante_${fileDate}.pdf`;
    const filePath = path.join(folderPath, fileName);

    // Salvando o PDF
    fs.writeFileSync(filePath, buffer);
    console.log(`✅ PDF salvo em: ${filePath}`);
}

// Iniciando o cliente WhatsApp
startClient();

// Captura de exceções não tratadas
process.on('uncaughtException', err => console.error('❌ Erro não capturado:', err));
