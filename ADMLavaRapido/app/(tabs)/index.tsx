import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, Text, View, FlatList, TouchableOpacity, 
  SafeAreaView, StatusBar, ActivityIndicator, Alert 
} from 'react-native';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, query, onSnapshot, 
  doc, updateDoc, deleteDoc, orderBy 
} from 'firebase/firestore';

// Configurações do seu Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAjOP5NJ-09eDXsDTaorJL49Or_a_HlMgc",
  authDomain: "lava-rapido-rogerio.firebaseapp.com",
  projectId: "lava-rapido-rogerio",
  storageBucket: "lava-rapido-rogerio.firebasestorage.app",
  messagingSenderId: "240495948059",
  appId: "1:240495948059:web:cf2228cdb92e9cd35d63be"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export default function App() {
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "pedidos"), orderBy("data_agendamento", "asc"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const docs = [];
      querySnapshot.forEach((doc) => {
        docs.push({ ...doc.data(), id: doc.id });
      });
      setPedidos(docs);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const formatarTelefone = (num) => {
    if (!num) return "Pendente";
    let limpo = String(num).replace(/\D/g, "");
    if (limpo.startsWith("55") && limpo.length > 11) limpo = limpo.substring(2);
    if (limpo.length === 11) return `(${limpo.substring(0, 2)}) ${limpo.substring(2, 7)}-${limpo.substring(7)}`;
    if (limpo.length === 10) return `(${limpo.substring(0, 2)}) ${limpo.substring(2, 6)}-${limpo.substring(6)}`;
    return limpo;
  };

  const alterarStatus = async (id, status) => {
    try {
      await updateDoc(doc(db, "pedidos", id), { status });
    } catch (e) {
      Alert.alert("Erro", "Falha ao atualizar o status.");
    }
  };

  const deletar = (id) => {
    Alert.alert("Excluir", "Remover agendamento?", [
      { text: "Não" },
      { text: "Sim", onPress: async () => await deleteDoc(doc(db, "pedidos", id)) }
    ]);
  };

  const renderItem = ({ item }) => (
    <View style={[styles.card, item.status === 'concluido' && styles.cardConcluido]}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.clienteNome}>👤 {item.nome_cliente}</Text>
          <Text style={styles.clienteWhats}>📞 {formatarTelefone(item.whatsapp)}</Text>
        </View>
        <View style={styles.badgePlaca}>
          <Text style={styles.placaText}>{item.veiculo_placa?.toUpperCase() || "S/P"}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <Text style={styles.veiculoInfo}>🚗 {item.veiculo_modelo} • {item.veiculo_cor}</Text>
      
      <View style={styles.timeRow}>
        <Text style={styles.timeValue}>⏰ {item.hora_inicio} às {item.hora_fim}</Text>
        <View style={[styles.statusTag, item.status === 'lavando' && { backgroundColor: '#f1c40f' }]}>
          <Text style={styles.statusTagText}>{item.status?.toUpperCase()}</Text>
        </View>
      </View>

      <Text style={styles.servicosText}>🛠️ {item.servicos?.join(' + ')}</Text>

      <View style={styles.footer}>
        <Text style={styles.valorTotal}>R$ {item.valor_total},00</Text>
        
        <View style={styles.actions}>
          {item.status === 'pendente' && (
            <TouchableOpacity style={styles.btnStart} onPress={() => alterarStatus(item.id, 'lavando')}>
              <Text style={styles.btnText}>INICIAR</Text>
            </TouchableOpacity>
          )}
          {item.status === 'lavando' && (
            <TouchableOpacity style={styles.btnDone} onPress={() => alterarStatus(item.id, 'concluido')}>
              <Text style={styles.btnText}>CONCLUIR</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.btnDelete} onPress={() => deletar(item.id)}>
            <Text style={styles.btnText}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a252f" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Lava Rápido do Rogério</Text>
        <Text style={styles.headerSubtitle}>Gestão em Tempo Real</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3498db" />
          <Text style={{ marginTop: 10, color: '#7f8c8d' }}>Sincronizando...</Text>
        </View>
      ) : (
        <FlatList
          data={pedidos}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listPadding}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Nenhum agendamento encontrado. ✨</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  header: { 
    backgroundColor: '#1a252f', 
    padding: 25, 
    paddingTop: 45, 
    borderBottomLeftRadius: 30, 
    borderBottomRightRadius: 30, 
    elevation: 10 
  },
  headerTitle: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  headerSubtitle: { color: '#bdc3c7', fontSize: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listPadding: { padding: 15, paddingBottom: 30 },
  card: { 
    backgroundColor: '#fff', 
    borderRadius: 20, 
    padding: 18, 
    marginBottom: 15, 
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10
  },
  cardConcluido: { opacity: 0.5, backgroundColor: '#ecf0f1' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  clienteNome: { fontSize: 20, fontWeight: 'bold', color: '#2c3e50' },
  clienteWhats: { fontSize: 15, color: '#3498db', fontWeight: 'bold', marginTop: 2 },
  badgePlaca: { backgroundColor: '#2c3e50', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  placaText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  veiculoInfo: { fontSize: 17, color: '#34495e', marginTop: 10, fontWeight: '500' },
  divider: { height: 1, backgroundColor: '#f1f2f6', marginVertical: 12 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timeValue: { color: '#e67e22', fontWeight: 'bold', fontSize: 15 },
  statusTag: { backgroundColor: '#bdc3c7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 5 },
  statusTagText: { fontSize: 10, color: '#fff', fontWeight: 'bold' },
  servicosText: { fontSize: 14, color: '#95a5a6', fontStyle: 'italic', marginTop: 5 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 },
  valorTotal: { fontSize: 24, fontWeight: 'bold', color: '#27ae60' },
  actions: { flexDirection: 'row', gap: 10 },
  btnStart: { backgroundColor: '#f1c40f', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 10 },
  btnDone: { backgroundColor: '#2ecc71', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 10 },
  btnDelete: { backgroundColor: '#ffefef', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  emptyText: { textAlign: 'center', marginTop: 100, color: '#bdc3c7', fontSize: 16 }
});