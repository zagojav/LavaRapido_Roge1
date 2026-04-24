const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const admin = require('firebase-admin');

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const sessoes = {};

// --- FUNÇÕES DE APOIO ---
function calcularDuracao(quantidadeServicos) {
    if (quantidadeServicos <= 1) return 60;
    return 60 + (quantidadeServicos - 1) * 30;
}

function formatarData(data) {
    return data.toISOString().split('T')[0];
}

function obterProximosDias() {
    const dias = [];
    const nomesDias = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        if (d.getDay() !== 0) { // Pula domingo
            dias.push({
                data: formatarData(d),
                label: `${nomesDias[d.getDay()]} (${d.getDate()}/${d.getMonth() + 1})`
            });
        }
    }
    return dias;
}

const msgErroPadrao = "❌ *Desculpe, não entendi!*\n\nPor favor, digite apenas uma das **opções numeradas** ou o **nome exato** que aparece na mensagem acima.";

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
});

client.on('qr', (qr) => { qrcode.generate(qr, { small: true }); });

client.on('ready', () => { console.log('🚀 Sistema do Rogério 100% Operacional!'); });

client.on('message', async message => {
    const numero = message.from;
    const texto = message.body.trim();
    const textoBaixo = texto.toLowerCase();
    const antiCrash = { sendSeen: false };

    if (!sessoes[numero]) {
        sessoes[numero] = { etapa: 0, nome: '', servicos: [], total: 0, veiculo: '', cor: '', placa: '', data: '', hora: '', duracao: 0 };
    }

    const cliente = sessoes[numero];

    if (textoBaixo === 'cancelar' || textoBaixo === 'sair') {
        delete sessoes[numero];
        return client.sendMessage(numero, '❌ *Atendimento cancelado.*', antiCrash);
    }

    try {
        // ETAPA 0: SAUDAÇÃO
        if (cliente.etapa === 0) {
            if (['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'opa', 'salve', 'fala rogerio', 'fala mestre'].includes(textoBaixo)) {
                cliente.etapa = 1;
                return client.sendMessage(numero, `*LAVA RÁPIDO DO ROGÉRIO* 🚗🚿\n\nOlá! Para iniciarmos seu agendamento, por favor, me diga:\n\n👉 *Qual o seu nome?*`, antiCrash);
            }
        }

        // ETAPA 1: MENU COM DESCRIÇÕES
        else if (cliente.etapa === 1) {
            cliente.nome = texto;
            cliente.etapa = 2;
            const menu = `Prazer, *${cliente.nome}*! 🤝\n\nQual serviço você deseja fazer hoje? (Digite o número ou nome):\n\n1️⃣ *Externa* (R$ 50,00)\n_Lavagem da lataria, rodas e secagem premium._\n\n2️⃣ *Interna* (R$ 40,00)\n_Aspiração completa, limpeza de painéis e vidros._\n\n3️⃣ *Completa* (R$ 80,00)\n_O combo Externa + Interna com cera protetora._\n\n4️⃣ *Higienização* (R$ 150,00)\n_Limpeza profunda de bancos, teto e carpetes._\n\n5️⃣ *Finalização* (R$ 30,00)\n_Pretinho nos pneus e perfume exclusivo no interior._\n\n_(Para interromper, digite *Cancelar*)_`;
            return client.sendMessage(numero, menu, antiCrash);
        }

        // ETAPA 2: SELEÇÃO DE SERVIÇO + ERRO
        else if (cliente.etapa === 2) {
            let escolheu = ""; let preco = 0;
            if (textoBaixo === '1' || textoBaixo.includes('externa')) { escolheu = "Lavagem Externa"; preco = 50; }
            else if (textoBaixo === '2' || textoBaixo.includes('interna')) { escolheu = "Lavagem Interna"; preco = 40; }
            else if (textoBaixo === '3' || textoBaixo.includes('completa')) { escolheu = "Lavagem Completa"; preco = 80; }
            else if (textoBaixo === '4' || textoBaixo.includes('higieniza')) { escolheu = "Higienização"; preco = 150; }
            else if (textoBaixo === '5' || textoBaixo.includes('finaliza')) { escolheu = "Finalização"; preco = 30; }

            if (escolheu !== "") {
                cliente.servicos.push(escolheu);
                cliente.total += preco;
                cliente.etapa = 3;
                return client.sendMessage(numero, `✅ *${escolheu}* adicionado!\n\n🛒 *Subtotal:* R$ ${cliente.total},00\n\nDeseja adicionar mais algum serviço?\n👉 Digite *MAIS* para escolher outro.\n👉 Digite *FINALIZAR* para prosseguir.`, antiCrash);
            } else {
                return client.sendMessage(numero, msgErroPadrao, antiCrash);
            }
        }

        // ETAPA 3: MAIS OU FINALIZAR + ERRO
        else if (cliente.etapa === 3) {
            if (textoBaixo.includes('mais')) {
                cliente.etapa = 2;
                return client.sendMessage(numero, 'Certo! Qual outro serviço você quer adicionar? (1 a 5)', antiCrash);
            } else if (textoBaixo.includes('finalizar')) {
                cliente.etapa = 4;
                return client.sendMessage(numero, 'Perfeito! Agora os dados do carro:\n\n👉 *Qual o modelo?*', antiCrash);
            } else {
                return client.sendMessage(numero, msgErroPadrao, antiCrash);
            }
        }

        // ETAPA 4, 5 e 6: DADOS DO CARRO
        else if (cliente.etapa === 4) { cliente.veiculo = texto; cliente.etapa = 5; return client.sendMessage(numero, `👉 *Qual a cor do ${cliente.veiculo}?*`, antiCrash); }
        else if (cliente.etapa === 5) { cliente.cor = texto; cliente.etapa = 6; return client.sendMessage(numero, `👉 *Qual a placa?*`, antiCrash); }

        // ETAPA 6: ESCOLHER DIA + ERRO
        else if (cliente.etapa === 6) {
            cliente.placa = texto;
            cliente.etapa = 7;
            const proximosDias = obterProximosDias();
            let msgDias = `📅 *Escolha o dia para o seu agendamento:*\n\n`;
            proximosDias.forEach((d, index) => { msgDias += `${index + 1}️⃣ ${d.label}\n`; });
            cliente.listaDias = proximosDias;
            return client.sendMessage(numero, msgDias, antiCrash);
        }

        // ETAPA 7: ESCOLHER HORA + ERRO
        else if (cliente.etapa === 7) {
            const index = parseInt(texto) - 1;
            if (cliente.listaDias && cliente.listaDias[index]) {
                cliente.data = cliente.listaDias[index].data;
                cliente.duracao = calcularDuracao(cliente.servicos.length);
                
                const snapshot = await db.collection('pedidos').where('data_agendamento', '==', cliente.data).get();
                const ocupados = [];
                snapshot.forEach(doc => { const d = doc.data(); ocupados.push({ inicio: d.hora_inicio }); });

                const diaSemana = new Date(cliente.data + 'T00:00:00').getDay();
                let horariosPossiveis = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
                if (diaSemana === 6) horariosPossiveis = ["09:00", "10:00", "11:00", "13:00", "14:00"];

                let msgHoras = `⏰ *Horários disponíveis para ${cliente.data.split('-').reverse().join('/')}:*\n\n`;
                horariosPossiveis.forEach((hora, idx) => {
                    const conflito = ocupados.some(o => o.inicio === hora);
                    msgHoras += conflito ? `❌ ~${hora}~ (Ocupado)\n` : `${idx + 1}️⃣ ${hora}\n`;
                });

                cliente.listaHoras = horariosPossiveis;
                cliente.etapa = 8;
                return client.sendMessage(numero, msgHoras, antiCrash);
            } else {
                return client.sendMessage(numero, msgErroPadrao, antiCrash);
            }
        }

        // ETAPA 8: FINALIZAR + ERRO
        else if (cliente.etapa === 8) {
            const horaIdx = parseInt(texto) - 1;
            const horaFinal = cliente.listaHoras[horaIdx];
            
            if (horaFinal) {
                cliente.hora = horaFinal;
                let [h, m] = horaFinal.split(':').map(Number);
                let totalMin = h * 60 + m + cliente.duracao;
                const horaFimFormatada = `${String(Math.floor(totalMin/60)).padStart(2, '0')}:${String(totalMin%60).padStart(2, '0')}`;

                await db.collection('pedidos').add({
                    nome_cliente: cliente.nome,
                    whatsapp: numero.replace('@c.us', ''),
                    veiculo_modelo: cliente.veiculo,
                    veiculo_cor: cliente.cor,
                    veiculo_placa: cliente.placa,
                    servicos: cliente.servicos,
                    valor_total: cliente.total,
                    data_agendamento: cliente.data,
                    hora_inicio: cliente.hora,
                    hora_fim: horaFimFormatada,
                    status: 'pendente',
                    data_criacao: new Date().toISOString()
                });

                const resumo = `🎉 *Tudo certo, ${cliente.nome}!* Agendado!\n\n📅 *Data:* ${cliente.data.split('-').reverse().join('/')}\n⏰ *Horário:* ${cliente.hora} às ${horaFimFormatada}\n🚗 *Veículo:* ${cliente.veiculo} (${cliente.cor})\n🛠️ *Serviços:* ${cliente.servicos.join(', ')}\n💰 *Total:* R$ ${cliente.total},00\n\n📍 Rua Rodamis Creti, 271.\nO Rogério te espera! 🚿✨`;

                delete sessoes[numero];
                return client.sendMessage(numero, resumo, antiCrash);
            } else {
                return client.sendMessage(numero, msgErroPadrao, antiCrash);
            }
        }
    } catch (e) { console.log(e); }
});

client.initialize();