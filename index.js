const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const admin = require('firebase-admin');

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const sessoes = {};

function calcularDuracao(servicos) {
    if (servicos.length <= 1) return 60;
    return 60 + (servicos.length - 1) * 30;
}

function obterProximosDias() {
    const dias = [];
    const nomes = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        if (d.getDay() !== 0) { 
            dias.push({ data: d.toISOString().split('T')[0], label: `${nomes[d.getDay()]} (${d.getDate()}/${d.getMonth() + 1})` });
        }
    }
    return dias;
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
    webVersionCache: { type: 'remote', remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html' }
});

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));

// =========================================================================
// O ESPIÃO: AGORA VERIFICA O ID EXATO NO SERVIDOR DO WHATSAPP
// =========================================================================
client.on('ready', () => { 
    console.log('🚀 Bot Online e Monitorando o Pátio com Validação de ID!');

    db.collection('pedidos').onSnapshot((snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'modified') {
                const pedido = change.doc.data();
                const idPedido = change.doc.id;
                
                try {
                    // Pega o chat_id salvo na hora que o cliente falou com o bot
                    let idParaEnviar = pedido.chat_id;

                    // Se não tiver o chat_id, o bot "pergunta" pro WhatsApp qual o ID certo
                    if (!idParaEnviar && pedido.whatsapp) {
                        let numeroLimpo = pedido.whatsapp.replace(/\D/g, "");
                        if (!numeroLimpo.startsWith('55')) numeroLimpo = '55' + numeroLimpo;
                        
                        // MÁGICA: getNumberId converte o telefone no ID (LID) correto do WhatsApp
                        const contatoValidado = await client.getNumberId(numeroLimpo);
                        
                        if (contatoValidado) {
                            idParaEnviar = contatoValidado._serialized;
                        } else {
                            console.log(`❌ WhatsApp não encontrou o número: ${numeroLimpo}`);
                            return; // Para tudo e não tenta enviar
                        }
                    }

                    if (pedido.status === 'lavando' && !pedido.notificado_lavando) {
                        console.log(`=> Disparando Zap de INÍCIO para: ${pedido.nome_cliente}`);
                        await client.sendMessage(idParaEnviar, `🚿 *Olá, ${pedido.nome_cliente}!*\n\nO Rogério acabou de iniciar o serviço no seu veículo. Capricho total em andamento! ✨`);
                        await db.collection('pedidos').doc(idPedido).update({ notificado_lavando: true });
                    }

                    if (pedido.status === 'concluido' && !pedido.notificado_concluido) {
                        console.log(`=> Disparando Zap de CONCLUSÃO para: ${pedido.nome_cliente}`);
                        await client.sendMessage(idParaEnviar, `✅ *Veículo Pronto, ${pedido.nome_cliente}!*\n\nO serviço foi finalizado. Sua nave está brilhando e pronta para ser retirada! 🚗✨`);
                        await db.collection('pedidos').doc(idPedido).update({ notificado_concluido: true });
                    }
                } catch (error) {
                    console.log('❌ Erro no envio automático:', error);
                }
            }
        });
    });
});
// =========================================================================

client.on('message', async message => {
    const idSessao = message.from;
    const texto = message.body.trim();
    const textoBaixo = texto.toLowerCase();

    if (!sessoes[idSessao]) sessoes[idSessao] = { etapa: 0, nome: '', telefone: '', servicos: [], total: 0, veiculo: '', cor: '', placa: '', data: '', hora: '' };
    const cliente = sessoes[idSessao];

    if (textoBaixo === 'cancelar') { delete sessoes[idSessao]; return message.reply('❌ Atendimento cancelado.'); }

    try {
        if (cliente.etapa === 0) {
            if (['oi', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'fala rogerio'].some(saudacao => textoBaixo.includes(saudacao))) {
                cliente.etapa = 1;
                return message.reply(`*LAVA RÁPIDO DO ROGÉRIO* 🚗🚿\n\nOlá! Para iniciarmos seu agendamento, por favor, me diga:\n\n👉 *Qual o seu nome?*`);
            }
        }
        else if (cliente.etapa === 1) {
            cliente.nome = texto; 
            cliente.etapa = 2;
            return message.reply(`Prazer, *${cliente.nome}*! 🤝\n\nAgora, por favor, digite seu **telefone com DDD** (Ex: 11945672341):`);
        }
        else if (cliente.etapa === 2) {
            cliente.telefone = texto.replace(/\D/g, ""); 
            cliente.etapa = 3;
            return message.reply(`Perfeito! Escolha o serviço desejado (Número ou Nome):\n\n1️⃣ *Externa* (R$ 50)\n_Lavagem da lataria e rodas._\n\n2️⃣ *Interna* (R$ 40)\n_Aspiração e limpeza interna._\n\n3️⃣ *Completa* (R$ 80)\n_Externa + Interna + Cera._\n\n4️⃣ *Higienização* (R$ 150)\n_Bancos, teto e carpetes._\n\n5️⃣ *Finalização* (R$ 30)\n_Pretinho e perfume premium._`);
        }
        else if (cliente.etapa === 3) {
            let s = ""; let p = 0;
            if (textoBaixo === '1' || textoBaixo.includes('externa')) { s = "Externa"; p = 50; }
            else if (textoBaixo === '2' || textoBaixo.includes('interna')) { s = "Interna"; p = 40; }
            else if (textoBaixo === '3' || textoBaixo.includes('completa')) { s = "Completa"; p = 80; }
            else if (textoBaixo === '4' || textoBaixo.includes('higieniza')) { s = "Higienização"; p = 150; }
            else if (textoBaixo === '5' || textoBaixo.includes('finaliza')) { s = "Finalização"; p = 30; }

            if (s) {
                cliente.servicos.push(s); cliente.total += p; cliente.etapa = 4;
                return message.reply(`✅ *${s}* adicionado!\n\n🛒 *Subtotal:* R$ ${cliente.total},00\n\nDeseja adicionar mais algum serviço?\n👉 Digite *MAIS* para outro.\n👉 Digite *FINALIZAR* para prosseguir.`);
            }
        }
        else if (cliente.etapa === 4) {
            if (textoBaixo.includes('mais')) { cliente.etapa = 3; return message.reply('Qual o próximo serviço?'); }
            else if (textoBaixo.includes('finalizar')) { cliente.etapa = 5; return message.reply('Ótima escolha! Agora os dados do veículo:\n\n👉 *Qual o modelo?*'); }
        }
        else if (cliente.etapa === 5) { cliente.veiculo = texto; cliente.etapa = 6; return message.reply(`👉 *Qual a cor do ${cliente.veiculo}?*`); }
        else if (cliente.etapa === 6) { cliente.placa = texto; cliente.etapa = 7; return message.reply(`👉 *Qual a placa?*`); }
        else if (cliente.etapa === 7) {
            cliente.placa = texto; cliente.etapa = 8;
            const dias = obterProximosDias(); cliente.listaDias = dias;
            let m = `📅 *Escolha o dia para o agendamento:*\n\n`;
            dias.forEach((d, i) => m += `${i+1}️⃣ ${d.label}\n`);
            return message.reply(m);
        }
        else if (cliente.etapa === 8) {
            const idx = parseInt(texto) - 1;
            if (cliente.listaDias[idx]) {
                cliente.data = cliente.listaDias[idx].data;
                const snap = await db.collection('pedidos').where('data_agendamento', '==', cliente.data).get();
                const ocupados = []; snap.forEach(doc => ocupados.push(doc.data().hora_inicio));
                
                let hDisp = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
                if (new Date(cliente.data + 'T00:00:00').getDay() === 6) hDisp = ["09:00", "10:00", "11:00", "13:00", "14:00"];

                let m = `⏰ *Horários disponíveis para ${cliente.data.split('-').reverse().join('/')}:*\n\n`;
                hDisp.forEach((h, i) => m += ocupados.includes(h) ? `❌ ~${h}~ (Ocupado)\n` : `${i+1}️⃣ ${h}\n`);
                cliente.listaHoras = hDisp; cliente.etapa = 9;
                return message.reply(m);
            }
        }
        else if (cliente.etapa === 9) {
            const hIdx = parseInt(texto) - 1;
            if (cliente.listaHoras[hIdx]) {
                cliente.hora = cliente.listaHoras[hIdx];
                let dur = calcularDuracao(cliente.servicos);
                let [h, m] = cliente.hora.split(':').map(Number);
                let totalM = h * 60 + m + dur;
                let hFim = `${String(Math.floor(totalM/60)).padStart(2,'0')}:${String(totalM%60).padStart(2,'0')}`;

                await db.collection('pedidos').add({
                    nome_cliente: cliente.nome,
                    whatsapp: cliente.telefone, 
                    chat_id: idSessao, // Salva o ID que o WhatsApp entende diretamente!
                    veiculo_modelo: cliente.veiculo,
                    veiculo_cor: cliente.cor,
                    veiculo_placa: cliente.placa,
                    servicos: cliente.servicos,
                    valor_total: cliente.total,
                    data_agendamento: cliente.data,
                    hora_inicio: cliente.hora,
                    hora_fim: hFim,
                    status: 'pendente',
                    notificado_lavando: false, 
                    notificado_concluido: false, 
                    data_criacao: new Date().toISOString()
                });

                message.reply(`🎉 *Agendamento Confirmado, ${cliente.nome}!*\n\n📅 *Data:* ${cliente.data.split('-').reverse().join('/')}\n⏰ *Horário:* ${cliente.hora} às ${hFim}\n🚗 *Veículo:* ${cliente.veiculo} (${cliente.cor})\n🛠️ *Serviços:* ${cliente.servicos.join(', ')}\n💰 *Total:* R$ ${cliente.total},00\n\n📍 Rua Rodamis Creti, 271.\nO Rogério te espera! 🚿✨`);
                delete sessoes[idSessao];
            }
        }
    } catch (e) { console.log(e); }
});

client.initialize();