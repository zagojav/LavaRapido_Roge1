const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const admin = require('firebase-admin');

// Certifique-se de que o serviceAccountKey.json está na mesma pasta!
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

// FUNÇÃO NOVA: Para não repetir o código de salvar no banco e mandar a mensagem final
async function finalizarAgendamento(cliente, idSessao, message) {
    let dur = calcularDuracao(cliente.servicos);
    let [h, m] = cliente.hora.split(':').map(Number);
    let totalM = h * 60 + m + dur;
    let hFim = `${String(Math.floor(totalM/60)).padStart(2,'0')}:${String(totalM%60).padStart(2,'0')}`;

    await db.collection('pedidos').add({
        nome_cliente: cliente.nome,
        whatsapp: cliente.telefone, 
        chat_id: idSessao, 
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

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
    webVersionCache: { type: 'remote', remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html' }
});

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));

client.on('ready', () => { 
    console.log('🚀 Bot Online, Monitorando o Pátio e com Inteligência de Histórico!');

    db.collection('pedidos').onSnapshot((snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'modified') {
                const pedido = change.doc.data();
                const idPedido = change.doc.id;
                const chatIdExato = pedido.chat_id;

                if (!chatIdExato) return; 

                try {
                    if (pedido.status === 'lavando' && pedido.notificado_lavando !== true) {
                        await db.collection('pedidos').doc(idPedido).update({ notificado_lavando: true });
                        await client.sendMessage(chatIdExato, `🚿 *Olá, ${pedido.nome_cliente}!*\n\nO Rogério acabou de iniciar o serviço no seu veículo. Capricho total em andamento! ✨`);
                    }

                    if (pedido.status === 'concluido' && pedido.notificado_concluido !== true) {
                        await db.collection('pedidos').doc(idPedido).update({ notificado_concluido: true });
                        await client.sendMessage(chatIdExato, `✅ *Veículo Pronto, ${pedido.nome_cliente}!*\n\nO serviço foi finalizado. Sua nave está brilhando e pronta para ser retirada! 🚗✨`);
                    }
                } catch (error) {
                    console.log('Erro ao processar notificação:', error);
                }
            }
        });
    });
});

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
            
            // --- BUSCA O HISTÓRICO DO CLIENTE AQUI ---
            const historicoSnap = await db.collection('pedidos').where('whatsapp', '==', cliente.telefone).get();
            if (!historicoSnap.empty) {
                const pedidosAntigos = [];
                historicoSnap.forEach(doc => pedidosAntigos.push(doc.data()));
                // Pega o pedido mais recente
                pedidosAntigos.sort((a, b) => new Date(b.data_criacao) - new Date(a.data_criacao));
                
                const ultimo = pedidosAntigos[0];
                cliente.hist_veiculo = ultimo.veiculo_modelo;
                cliente.hist_cor = ultimo.veiculo_cor;
                cliente.hist_placa = ultimo.veiculo_placa;
                cliente.hist_diaSemana = new Date(ultimo.data_agendamento + 'T00:00:00').getDay();
                cliente.hist_hora = ultimo.hora_inicio;
            }
            // -----------------------------------------

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
            if (textoBaixo.includes('mais')) { 
                cliente.etapa = 3; 
                return message.reply('Qual o próximo serviço?'); 
            }
            else if (textoBaixo.includes('finalizar')) { 
                // Se tiver histórico de veículo, vai pra etapa especial de confirmação
                if (cliente.hist_veiculo) {
                    cliente.etapa = 50;
                    return message.reply(`Ótima escolha!\n\nVejo que seu último agendamento foi com o veículo:\n🚗 *${cliente.hist_veiculo}* (${cliente.hist_cor}) - Placa: *${cliente.hist_placa}*\n\nDeseja agendar para este mesmo veículo?\n1️⃣ Sim\n2️⃣ Não, cadastrar outro`);
                } else {
                    cliente.etapa = 5; 
                    return message.reply('Ótima escolha! Agora os dados do veículo:\n\n👉 *Qual o modelo?*'); 
                }
            }
        }
        // ETAPA ESPECIAL 50: CONFIRMAR VEÍCULO ANTIGO
        else if (cliente.etapa === 50) {
            if (textoBaixo === '1' || textoBaixo.includes('sim')) {
                cliente.veiculo = cliente.hist_veiculo;
                cliente.cor = cliente.hist_cor;
                cliente.placa = cliente.hist_placa;

                // Se tem um padrão de horário, sugere ele
                if (cliente.hist_diaSemana !== undefined && cliente.hist_hora) {
                    const nomesDias = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
                    cliente.etapa = 51;
                    return message.reply(`📅 Notei um padrão! Você costuma agendar de *${nomesDias[cliente.hist_diaSemana]} às ${cliente.hist_hora}*.\n\nDeseja verificar disponibilidade para o próximo *${nomesDias[cliente.hist_diaSemana]}* neste mesmo horário?\n1️⃣ Sim, manter padrão\n2️⃣ Escolher outra data/horário`);
                } else {
                    // Sem padrão de horário, vai escolher a data normal
                    cliente.etapa = 8;
                    const dias = obterProximosDias(); cliente.listaDias = dias;
                    let m = `📅 *Escolha o dia para o agendamento:*\n\n`;
                    dias.forEach((d, i) => m += `${i+1}️⃣ ${d.label}\n`);
                    return message.reply(m);
                }
            } else {
                cliente.etapa = 5;
                return message.reply('Sem problemas! 👉 *Qual o modelo do novo veículo?*');
            }
        }
        // ETAPA ESPECIAL 51: CONFIRMAR PADRÃO DE HORÁRIO
        else if (cliente.etapa === 51) {
            if (textoBaixo === '1' || textoBaixo.includes('sim')) {
                const dias = obterProximosDias();
                const diaAlvo = dias.find(d => new Date(d.data + 'T00:00:00').getDay() === cliente.hist_diaSemana);
                
                if (diaAlvo) {
                    cliente.data = diaAlvo.data;
                    cliente.hora = cliente.hist_hora;
                    
                    // Verifica se o horário alvo está livre
                    const snap = await db.collection('pedidos').where('data_agendamento', '==', cliente.data).where('hora_inicio', '==', cliente.hora).get();
                    
                    if (snap.empty) {
                        // Horário livre! Finaliza direto.
                        return await finalizarAgendamento(cliente, idSessao, message);
                    } else {
                        // Ocupado
                        cliente.etapa = 8;
                        let m = `❌ Poxa, no próximo dia disponível para este padrão o horário já está ocupado.\n\n📅 *Escolha outro dia:*\n\n`;
                        dias.forEach((d, i) => m += `${i+1}️⃣ ${d.label}\n`);
                        return message.reply(m);
                    }
                }
            }
            // Se disse não ou se não encontrou o dia, vai para a escolha normal de data
            cliente.etapa = 8;
            const dias = obterProximosDias(); cliente.listaDias = dias;
            let m = `📅 *Escolha o dia para o agendamento:*\n\n`;
            dias.forEach((d, i) => m += `${i+1}️⃣ ${d.label}\n`);
            return message.reply(m);
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
                await finalizarAgendamento(cliente, idSessao, message);
            }
        }
    } catch (e) { console.log(e); }
});

client.initialize();