// ============================================================
// Batería de pruebas de firestore.rules — 92 casos.
// Requiere: npm install -D @firebase/rules-unit-testing firebase
// Ejecutar:  firebase emulators:exec --only firestore "node firestore_rules_test.js"
// ============================================================
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, serverTimestamp } = require('firebase/firestore');

let testEnv;

async function setup() {
  testEnv = await initializeTestEnvironment({
    projectId: 'la-batalla-rules-test',
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, 'firestore.rules'), 'utf8') },
  });
}
async function seedWithoutRules(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });
}
async function run(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); }
  catch (e) { console.error(`❌ ${name}\n   ${e.message}`); process.exitCode = 1; }
}

// Las reglas exigen que users/{uid}.email == request.auth.token.email, así
// que todo contexto autenticado debe declarar el correo de su token — es lo
// que hace Firebase Auth de verdad.
const como = (uid, email) => testEnv.authenticatedContext(uid, email ? { email } : undefined).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

const perfil = (email, name, role, status) => ({
  email, name, role, status, createdAt: serverTimestamp(), schemaVersion: 1,
});
const vehiculo = (name, slug) => ({
  name, price: 500000, category: 'sedanes', condition: 'usado',
  brand: 'Toyota', year: '2024', carfax: 'si', slug,
});

async function main() {
  await setup();

  await run('Cliente crea su propio documento con role:customer → permitido', async () => {
    const db = como('customer1', 'c1@test.com');
    await assertSucceeds(setDoc(doc(db, 'users', 'customer1'), perfil('c1@test.com', 'Cliente Uno', 'customer', 'active')));
  });

  await run('Cliente intenta crearse como admin → denegado', async () => {
    const db = como('customer2', 'c2@test.com');
    await assertFails(setDoc(doc(db, 'users', 'customer2'), perfil('c2@test.com', 'Cliente Dos', 'admin', 'active')));
  });

  await run('Cliente intenta cambiar su role después → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'customer3'), perfil('c3@test.com', 'C3', 'customer', 'active')));
    const db = como('customer3', 'c3@test.com');
    await assertFails(updateDoc(doc(db, 'users', 'customer3'), { role: 'admin' }));
  });

  await run('Admin cambia el role de otro usuario → permitido', async () => {
    await seedWithoutRules(async db => {
      await setDoc(doc(db, 'users', 'admin1'), perfil('a1@test.com', 'Admin', 'admin', 'active'));
      await setDoc(doc(db, 'users', 'customer4'), perfil('c4@test.com', 'C4', 'customer', 'active'));
    });
    const db = como('admin1', 'a1@test.com');
    await assertSucceeds(updateDoc(doc(db, 'users', 'customer4'), { role: 'editor' }));
  });

  await run('Usuario disabled intenta modificar vehículos → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'disabled1'), perfil('d1@test.com', 'D1', 'editor', 'disabled')));
    const db = como('disabled1', 'd1@test.com');
    await assertFails(setDoc(doc(db, 'vehicles', 'v1'), vehiculo('Toyota Corolla 2024', 'toyota-corolla-2024')));
  });

  await run('Cliente intenta crear vehículos → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'customer5'), perfil('c5@test.com', 'C5', 'customer', 'active')));
    const db = como('customer5', 'c5@test.com');
    await assertFails(setDoc(doc(db, 'vehicles', 'v2'), vehiculo('Honda Civic 2024', 'honda-civic-2024')));
  });

  await run('Editor crea/edita vehículos → permitido', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'editor1'), perfil('e1@test.com', 'E1', 'editor', 'active')));
    const db = como('editor1', 'e1@test.com');
    await assertSucceeds(setDoc(doc(db, 'vehicles', 'v3'), vehiculo('Kia Sportage 2025', 'kia-sportage-2025')));
  });

  await run('Sales intenta editar vehículos → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'sales1'), perfil('s1@test.com', 'S1', 'sales', 'active')));
    const db = como('sales1', 's1@test.com');
    await assertFails(setDoc(doc(db, 'vehicles', 'v4'), vehiculo('Ford Ranger 2024', 'ford-ranger-2024')));
  });

  await run('Cliente intenta modificar su propio email → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'customer6'), perfil('c6@test.com', 'C6', 'customer', 'active')));
    const db = como('customer6', 'c6@test.com');
    await assertFails(updateDoc(doc(db, 'users', 'customer6'), { email: 'nuevo@test.com' }));
  });

  await run('Correo en la whitelist se auto-promueve a admin → permitido', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'whitelisted1'), perfil('manuel15160410@gmail.com', 'Manuel', 'customer', 'active')));
    const db = como('whitelisted1', 'manuel15160410@gmail.com');
    await assertSucceeds(updateDoc(doc(db, 'users', 'whitelisted1'), { role: 'admin' }));
  });

  await run('Correo NO whitelisteado intenta auto-promoverse a admin → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'customer10'), perfil('atacante@test.com', 'Atacante', 'customer', 'active')));
    const db = como('customer10', 'atacante@test.com');
    await assertFails(updateDoc(doc(db, 'users', 'customer10'), { role: 'admin' }));
  });

  await run('Cliente intenta modificar schemaVersion → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'customer7'), perfil('c7@test.com', 'C7', 'customer', 'active')));
    const db = como('customer7', 'c7@test.com');
    await assertFails(updateDoc(doc(db, 'users', 'customer7'), { schemaVersion: 2 }));
  });

  await run('Editor intenta modificar users → denegado', async () => {
    await seedWithoutRules(async db => {
      await setDoc(doc(db, 'users', 'editor2'), perfil('e2@test.com', 'E2', 'editor', 'active'));
      await setDoc(doc(db, 'users', 'customer8'), perfil('c8@test.com', 'C8', 'customer', 'active'));
    });
    const db = como('editor2', 'e2@test.com');
    await assertFails(updateDoc(doc(db, 'users', 'customer8'), { role: 'admin' }));
  });

  await run('Admin intenta asignar role="pepito" → denegado', async () => {
    await seedWithoutRules(async db => {
      await setDoc(doc(db, 'users', 'admin2'), perfil('a2@test.com', 'Admin2', 'admin', 'active'));
      await setDoc(doc(db, 'users', 'customer9'), perfil('c9@test.com', 'C9', 'customer', 'active'));
    });
    const db = como('admin2', 'a2@test.com');
    await assertFails(updateDoc(doc(db, 'users', 'customer9'), { role: 'pepito' }));
  });

  await run('Usuario sin documento en users intenta crear vehículos → denegado', async () => {
    const db = como('ghost1', 'ghost@test.com');
    await assertFails(setDoc(doc(db, 'vehicles', 'v5'), vehiculo('Nissan Frontier 2024', 'nissan-frontier-2024')));
  });

  // ---------- config/finanzas (tasa USD->RD$) ----------
  // Regresión: sin la regla `match /config/{docId}` esta lectura caía en el
  // deny por defecto y la tasa configurable nunca funcionaba en producción.
  await run('Visitante anónimo lee config/finanzas (tasa USD) → permitido', async () => {
    await seedWithoutRules(async db => {
      await setDoc(doc(db, 'config', 'finanzas'), { tasaUsdRd: 62.5 });
    });
    const db = anon();
    await assertSucceeds(getDoc(doc(db, 'config', 'finanzas')));
  });

  await run('Visitante anónimo escribe config/finanzas → denegado', async () => {
    const db = anon();
    await assertFails(setDoc(doc(db, 'config', 'finanzas'), { tasaUsdRd: 1 }));
  });

  await run('Cliente autenticado escribe config/finanzas → denegado', async () => {
    await seedWithoutRules(async db => {
      await setDoc(doc(db, 'users', 'cfgCustomer'), perfil('cfgc@test.com', 'C', 'customer', 'active'));
    });
    const db = como('cfgCustomer', 'cfgc@test.com');
    await assertFails(setDoc(doc(db, 'config', 'finanzas'), { tasaUsdRd: 1 }));
  });

  await run('Editor escribe config/finanzas → denegado (solo admin)', async () => {
    await seedWithoutRules(async db => {
      await setDoc(doc(db, 'users', 'cfgEditor'), perfil('cfge@test.com', 'E', 'editor', 'active'));
    });
    const db = como('cfgEditor', 'cfge@test.com');
    await assertFails(setDoc(doc(db, 'config', 'finanzas'), { tasaUsdRd: 1 }));
  });

  await run('Admin actualiza la tasa USD → permitido', async () => {
    await seedWithoutRules(async db => {
      await setDoc(doc(db, 'users', 'cfgAdmin'), perfil('cfga@test.com', 'A', 'admin', 'active'));
    });
    const db = como('cfgAdmin', 'cfga@test.com');
    await assertSucceeds(setDoc(doc(db, 'config', 'finanzas'), { tasaUsdRd: 63 }));
  });

  await run('Admin intenta guardar una tasa inválida (texto) → denegado', async () => {
    const db = como('cfgAdmin', 'cfga@test.com');
    await assertFails(setDoc(doc(db, 'config', 'finanzas'), { tasaUsdRd: 'mucho' }));
  });

  await run('Admin intenta colar un campo extra en config → denegado', async () => {
    const db = como('cfgAdmin', 'cfga@test.com');
    await assertFails(setDoc(doc(db, 'config', 'finanzas'), { tasaUsdRd: 63, backdoor: true }));
  });

  // ==========================================================
  // ESCALADA DE PRIVILEGIOS — el ataque real que las reglas permitían
  // ==========================================================
  await run('[ATAQUE] Registrarse declarando el email de la whitelist → denegado', async () => {
    // Antes esto se permitía: `email` solo se validaba como cadena, sin
    // atarlo al correo autenticado. Era el primer paso de la escalada.
    await assertFails(setDoc(doc(como('atacante1', 'atacante@evil.com'), 'users', 'atacante1'),
      perfil('manuel15160410@gmail.com', 'Atacante', 'customer', 'active')));
  });

  await run('[ATAQUE] Documento con email falsificado no puede promoverse a admin → denegado', async () => {
    // Aunque el documento ya existiera de antes con el email falsificado,
    // la promoción exige ahora que ese email sea el del token.
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'atacante2'),
      perfil('manuel15160410@gmail.com', 'Atacante', 'customer', 'active')));
    await assertFails(updateDoc(doc(como('atacante2', 'atacante@evil.com'), 'users', 'atacante2'),
      { role: 'admin' }));
  });

  await run('Registro normal: el email del documento es el del token → permitido', async () => {
    await assertSucceeds(setDoc(doc(como('legit1', 'legit@test.com'), 'users', 'legit1'),
      perfil('legit@test.com', 'Legítimo', 'customer', 'active')));
  });

  await run('Registro con un email distinto al del token → denegado', async () => {
    await assertFails(setDoc(doc(como('legit2', 'legit2@test.com'), 'users', 'legit2'),
      perfil('otro@test.com', 'Otro', 'customer', 'active')));
  });

  // ==========================================================
  // USERS — lectura y perfiles ajenos
  // ==========================================================
  await run('Usuario lee su propio perfil → permitido', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'lect1'), perfil('lect1@test.com', 'L1', 'customer', 'active')));
    await assertSucceeds(getDoc(doc(como('lect1', 'lect1@test.com'), 'users', 'lect1')));
  });

  await run('Usuario lee el perfil de OTRO → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'lect2'), perfil('lect2@test.com', 'L2', 'customer', 'active')));
    await assertFails(getDoc(doc(como('lect1', 'lect1@test.com'), 'users', 'lect2')));
  });

  await run('Usuario modifica el perfil de OTRO → denegado', async () => {
    await assertFails(updateDoc(doc(como('lect1', 'lect1@test.com'), 'users', 'lect2'), { name: 'Hackeado' }));
  });

  await run('Usuario edita datos propios no sensibles → permitido', async () => {
    await assertSucceeds(updateDoc(doc(como('lect1', 'lect1@test.com'), 'users', 'lect1'),
      { name: 'Nombre Nuevo', city: 'Santiago' }));
  });

  await run('Usuario intenta cambiar su propio status → denegado', async () => {
    await assertFails(updateDoc(doc(como('lect1', 'lect1@test.com'), 'users', 'lect1'), { status: 'disabled' }));
  });

  await run('Admin lee el perfil de cualquier usuario → permitido', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'adminL'), perfil('adminl@test.com', 'AL', 'admin', 'active')));
    await assertSucceeds(getDoc(doc(como('adminL', 'adminl@test.com'), 'users', 'lect2')));
  });

  await run('Admin desactiva a un usuario (operación administrativa) → permitido', async () => {
    await assertSucceeds(updateDoc(doc(como('adminL', 'adminl@test.com'), 'users', 'lect2'), { status: 'disabled' }));
  });

  await run('Admin BORRA el documento de un usuario → permitido', async () => {
    // Antes era una regla muerta: validUserProfile(request.resource.data)
    // con request.resource == null en un delete daba error y denegaba.
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'borrable'), perfil('b@test.com', 'B', 'customer', 'active')));
    await assertSucceeds(deleteDoc(doc(como('adminL', 'adminl@test.com'), 'users', 'borrable')));
  });

  await run('Admin intenta inyectar un campo arbitrario en un perfil → denegado', async () => {
    // La rama de admin era la única sin lista cerrada de campos.
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'victima1'), perfil('v1@test.com', 'V1', 'customer', 'active')));
    await assertFails(setDoc(doc(como('adminL', 'adminl@test.com'), 'users', 'victima1'),
      Object.assign(perfil('v1@test.com', 'V1', 'customer', 'active'), { campoInventado: 'x' })));
  });

  await run('Anónimo intenta crear un perfil → denegado', async () => {
    await assertFails(setDoc(doc(anon(), 'users', 'anon1'), perfil('a@test.com', 'A', 'customer', 'active')));
  });

  await run('Anónimo intenta leer un perfil → denegado', async () => {
    await assertFails(getDoc(doc(anon(), 'users', 'lect1')));
  });

  // ==========================================================
  // VEHÍCULOS — lectura pública y escritura restringida
  // ==========================================================
  await run('Visitante anónimo lee el catálogo → permitido', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'vehicles', 'pub1'), vehiculo('Mazda 3 2023', 'mazda-3-2023')));
    await assertSucceeds(getDoc(doc(anon(), 'vehicles', 'pub1')));
  });

  await run('Visitante anónimo lista el catálogo → permitido', async () => {
    await assertSucceeds(getDocs(collection(anon(), 'vehicles')));
  });

  await run('Anónimo intenta crear un vehículo → denegado', async () => {
    await assertFails(setDoc(doc(anon(), 'vehicles', 'anonV'), vehiculo('Pirata 2024', 'pirata-2024')));
  });

  await run('Anónimo intenta borrar un vehículo → denegado', async () => {
    await assertFails(deleteDoc(doc(anon(), 'vehicles', 'pub1')));
  });

  await run('Cliente intenta borrar un vehículo → denegado', async () => {
    await assertFails(deleteDoc(doc(como('lect1', 'lect1@test.com'), 'vehicles', 'pub1')));
  });

  await run('Admin borra un vehículo → permitido', async () => {
    await assertSucceeds(deleteDoc(doc(como('adminL', 'adminl@test.com'), 'vehicles', 'pub1')));
  });

  await run('Admin intenta colar un campo no permitido en un vehículo → denegado', async () => {
    await assertFails(setDoc(doc(como('adminL', 'adminl@test.com'), 'vehicles', 'malo1'),
      Object.assign(vehiculo('Con Extra 2024', 'con-extra-2024'), { ownerUid: 'adminL' })));
  });

  await run('Admin intenta guardar un año inválido → denegado', async () => {
    await assertFails(setDoc(doc(como('adminL', 'adminl@test.com'), 'vehicles', 'malo2'),
      Object.assign(vehiculo('Año Malo', 'anio-malo'), { year: '24' })));
  });

  await run('Admin intenta guardar un precio negativo → denegado', async () => {
    await assertFails(setDoc(doc(como('adminL', 'adminl@test.com'), 'vehicles', 'malo3'),
      Object.assign(vehiculo('Precio Malo', 'precio-malo'), { price: -5 })));
  });

  await run('Publicar en RD$ con priceDisplay:null → permitido (payload real del formulario)', async () => {
    // Regresión del bug que impedía publicar en pesos: readPublishForm()
    // manda priceDisplay:null y priceUSD:null cuando la moneda es RD$.
    await assertSucceeds(setDoc(doc(como('adminL', 'adminl@test.com'), 'vehicles', 'rd1'),
      Object.assign(vehiculo('Publicado En Pesos 2025', 'publicado-en-pesos-2025'),
        { currency: 'RD', priceUSD: null, priceDisplay: null })));
  });

  await run('Publicar en USD con priceDisplay de texto → permitido', async () => {
    await assertSucceeds(setDoc(doc(como('adminL', 'adminl@test.com'), 'vehicles', 'usd1'),
      Object.assign(vehiculo('Publicado En Dolares 2025', 'publicado-en-dolares-2025'),
        { currency: 'USD', priceUSD: 25000, priceDisplay: 'USD$ 25,000 (RD$ 1,550,000)' })));
  });

  await run('priceDisplay que no es ni texto ni null → denegado', async () => {
    await assertFails(setDoc(doc(como('adminL', 'adminl@test.com'), 'vehicles', 'pd1'),
      Object.assign(vehiculo('Display Malo 2025', 'display-malo-2025'), { priceDisplay: 123 })));
  });

  // ==========================================================
  // FAVORITOS — lectura propia (estaba denegada) y aislamiento
  // ==========================================================
  await run('Usuario LEE un favorito propio → permitido', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'favA', 'favorites', 'veh1'), { addedAt: new Date() }));
    await assertSucceeds(getDoc(doc(como('favA', 'fava@test.com'), 'users', 'favA', 'favorites', 'veh1')));
  });

  await run('Usuario LISTA sus favoritos → permitido', async () => {
    await assertSucceeds(getDocs(collection(como('favA', 'fava@test.com'), 'users', 'favA', 'favorites')));
  });

  await run('Usuario crea un favorito propio → permitido', async () => {
    await assertSucceeds(setDoc(doc(como('favA', 'fava@test.com'), 'users', 'favA', 'favorites', 'veh2'),
      { addedAt: new Date() }));
  });

  await run('Usuario borra un favorito propio → permitido', async () => {
    await assertSucceeds(deleteDoc(doc(como('favA', 'fava@test.com'), 'users', 'favA', 'favorites', 'veh2')));
  });

  await run('Usuario intenta colar un campo extra en un favorito → denegado', async () => {
    await assertFails(setDoc(doc(como('favA', 'fava@test.com'), 'users', 'favA', 'favorites', 'veh3'),
      { addedAt: new Date(), vehicleId: 'x' }));
  });

  await run('Usuario B LEE los favoritos de A → denegado', async () => {
    await assertFails(getDoc(doc(como('favB', 'favb@test.com'), 'users', 'favA', 'favorites', 'veh1')));
  });

  await run('Usuario B ESCRIBE en los favoritos de A → denegado', async () => {
    await assertFails(setDoc(doc(como('favB', 'favb@test.com'), 'users', 'favA', 'favorites', 'veh9'),
      { addedAt: new Date() }));
  });

  await run('Anónimo intenta escribir favoritos → denegado', async () => {
    await assertFails(setDoc(doc(anon(), 'users', 'favA', 'favorites', 'veh8'), { addedAt: new Date() }));
  });

  // ==========================================================
  // PREFERENCIAS — lectura propia (también estaba denegada)
  // ==========================================================
  await run('Usuario LEE sus preferencias → permitido', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'favA', 'preferences', 'settings'), { brands: ['Toyota'] }));
    await assertSucceeds(getDoc(doc(como('favA', 'fava@test.com'), 'users', 'favA', 'preferences', 'settings')));
  });

  await run('Usuario guarda sus preferencias → permitido', async () => {
    await assertSucceeds(setDoc(doc(como('favA', 'fava@test.com'), 'users', 'favA', 'preferences', 'settings'),
      { brands: ['Kia'], priceMin: 100000 }));
  });

  await run('Usuario B lee las preferencias de A → denegado', async () => {
    await assertFails(getDoc(doc(como('favB', 'favb@test.com'), 'users', 'favA', 'preferences', 'settings')));
  });

  // ==========================================================
  // COTIZACIONES
  // ==========================================================
  const cotiz = () => ({ vehicleId: 'veh1', vehicleName: 'Toyota Corolla 2024', downPayment: 100000,
    termMonths: 48, monthlyPayment: 12000, createdAt: serverTimestamp() });

  await run('Usuario crea una cotización propia → permitido', async () => {
    await assertSucceeds(setDoc(doc(como('favA', 'fava@test.com'), 'users', 'favA', 'quotes', 'q1'), cotiz()));
  });

  await run('Usuario lee sus cotizaciones → permitido', async () => {
    await assertSucceeds(getDocs(collection(como('favA', 'fava@test.com'), 'users', 'favA', 'quotes')));
  });

  await run('Usuario borra una cotización propia → permitido', async () => {
    await assertSucceeds(deleteDoc(doc(como('favA', 'fava@test.com'), 'users', 'favA', 'quotes', 'q1')));
  });

  await run('Usuario B lee las cotizaciones de A → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'favA', 'quotes', 'q2'), { vehicleName: 'X' }));
    await assertFails(getDoc(doc(como('favB', 'favb@test.com'), 'users', 'favA', 'quotes', 'q2')));
  });

  await run('Usuario B borra una cotización de A → denegado', async () => {
    await assertFails(deleteDoc(doc(como('favB', 'favb@test.com'), 'users', 'favA', 'quotes', 'q2')));
  });

  await run('Una cotización no se puede modificar una vez creada → denegado', async () => {
    await assertFails(updateDoc(doc(como('favA', 'fava@test.com'), 'users', 'favA', 'quotes', 'q2'),
      { monthlyPayment: 1 }));
  });

  await run('Anónimo intenta crear una cotización → denegado', async () => {
    await assertFails(setDoc(doc(anon(), 'users', 'favA', 'quotes', 'q3'), cotiz()));
  });

  // ==========================================================
  // CONFIG — alcance acotado a finanzas
  // ==========================================================
  await run('Admin escribe en un documento de config que NO es finanzas → denegado', async () => {
    await assertFails(setDoc(doc(como('cfgAdmin', 'cfga@test.com'), 'config', 'otroDoc'), { tasaUsdRd: 60 }));
  });

  await run('Visitante lee un documento de config que NO es finanzas → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'config', 'interno'), { secreto: 'x' }));
    await assertFails(getDoc(doc(anon(), 'config', 'interno')));
  });

  await run('Admin intenta guardar tasa 0 → denegado', async () => {
    await assertFails(setDoc(doc(como('cfgAdmin', 'cfga@test.com'), 'config', 'finanzas'), { tasaUsdRd: 0 }));
  });

  await run('Admin intenta guardar tasa negativa → denegado', async () => {
    await assertFails(setDoc(doc(como('cfgAdmin', 'cfga@test.com'), 'config', 'finanzas'), { tasaUsdRd: -5 }));
  });

  await run('Admin intenta guardar tasa mayor que 1000 → denegado', async () => {
    await assertFails(setDoc(doc(como('cfgAdmin', 'cfga@test.com'), 'config', 'finanzas'), { tasaUsdRd: 1001 }));
  });

  await run('Admin guarda tasa en el límite (1000) → permitido', async () => {
    await assertSucceeds(setDoc(doc(como('cfgAdmin', 'cfga@test.com'), 'config', 'finanzas'), { tasaUsdRd: 1000 }));
  });

  await run('Admin intenta BORRAR config/finanzas → denegado', async () => {
    await assertFails(deleteDoc(doc(como('cfgAdmin', 'cfga@test.com'), 'config', 'finanzas')));
  });

  // ==========================================================
  // REVISIÓN ADVERSARIAL — vectores probados contra las reglas ya corregidas
  // ==========================================================
  await run('Registro sin email en el token → denegado', async () => {
    // Sin email en el token no se puede satisfacer email == token.email.
    const sinMail = testEnv.authenticatedContext('sinMail').firestore();
    await assertFails(setDoc(doc(sinMail, 'users', 'sinMail'),
      perfil('cualquiera@test.com', 'X', 'customer', 'active')));
  });

  await run('Usuario borra su propio perfil para recrearse con otro rol → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'autoBorra'), perfil('ab@test.com', 'AB', 'customer', 'active')));
    await assertFails(deleteDoc(doc(como('autoBorra', 'ab@test.com'), 'users', 'autoBorra')));
  });

  await run('Editor intenta auto-promoverse a admin → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'edProm'), perfil('edprom@test.com', 'EP', 'editor', 'active')));
    await assertFails(updateDoc(doc(como('edProm', 'edprom@test.com'), 'users', 'edProm'), { role: 'admin' }));
  });

  await run('Usuario desactivado intenta reactivarse → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'desact'), perfil('des@test.com', 'D', 'customer', 'disabled')));
    await assertFails(updateDoc(doc(como('desact', 'des@test.com'), 'users', 'desact'), { status: 'active' }));
  });

  await run('Crear perfil con status:pending para esquivar isActive → denegado', async () => {
    await assertFails(setDoc(doc(como('pend1', 'pend1@test.com'), 'users', 'pend1'),
      perfil('pend1@test.com', 'P', 'customer', 'pending')));
  });

  await run('Un admin NO puede leer los favoritos de otro usuario → denegado', async () => {
    // Los datos personales del cliente no son datos de gestión.
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'privA', 'favorites', 'v1'), { addedAt: new Date() }));
    await assertFails(getDoc(doc(como('adminL', 'adminl@test.com'), 'users', 'privA', 'favorites', 'v1')));
  });

  await run('Un admin NO puede leer las cotizaciones de otro usuario → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'privA', 'quotes', 'q1'), { vehicleName: 'X' }));
    await assertFails(getDoc(doc(como('adminL', 'adminl@test.com'), 'users', 'privA', 'quotes', 'q1')));
  });

  await run('tasaUsdRd como booleano → denegado', async () => {
    await assertFails(setDoc(doc(como('cfgAdmin', 'cfga@test.com'), 'config', 'finanzas'), { tasaUsdRd: true }));
  });

  await run('tasaUsdRd como lista → denegado', async () => {
    await assertFails(setDoc(doc(como('cfgAdmin', 'cfga@test.com'), 'config', 'finanzas'), { tasaUsdRd: [60] }));
  });

  await run('tasaUsdRd como NaN → denegado', async () => {
    await assertFails(setDoc(doc(como('cfgAdmin', 'cfga@test.com'), 'config', 'finanzas'), { tasaUsdRd: NaN }));
  });

  await run('tasaUsdRd como Infinity → denegado', async () => {
    await assertFails(setDoc(doc(como('cfgAdmin', 'cfga@test.com'), 'config', 'finanzas'), { tasaUsdRd: Infinity }));
  });

  await run('config/finanzas sin el campo tasaUsdRd → denegado', async () => {
    await assertFails(setDoc(doc(como('cfgAdmin', 'cfga@test.com'), 'config', 'finanzas'), {}));
  });

  await run('Vehículo con categoría inventada → denegado', async () => {
    await assertFails(setDoc(doc(como('adminL', 'adminl@test.com'), 'vehicles', 'cat1'),
      Object.assign(vehiculo('Moto 2024', 'moto-2024'), { category: 'motos' })));
  });

  await run('Vehículo con slug en mayúsculas → denegado', async () => {
    await assertFails(setDoc(doc(como('adminL', 'adminl@test.com'), 'vehicles', 'slug1'),
      Object.assign(vehiculo('Slug Malo 2024', 'x'), { slug: 'MAL-Slug' })));
  });

  await run('Entrada de historial con campo extra → denegado', async () => {
    await assertFails(setDoc(doc(como('favA', 'fava@test.com'), 'users', 'favA', 'history', 'h9'),
      { vehicleId: 'v', viewedAt: serverTimestamp(), extra: 1 }));
  });

  await run('Preferencia con campo desconocido → denegado', async () => {
    await assertFails(setDoc(doc(como('favA', 'fava@test.com'), 'users', 'favA', 'preferences', 'settings'),
      { brands: ['X'], backdoor: 1 }));
  });

  // ==========================================================
  // COLECCIONES SIN REGLA — deny por defecto
  // ==========================================================
  await run('Anónimo escribe en una colección sin regla → denegado', async () => {
    await assertFails(setDoc(doc(anon(), 'coleccionInventada', 'x'), { a: 1 }));
  });

  await run('Admin escribe en una colección sin regla → denegado', async () => {
    await assertFails(setDoc(doc(como('adminL', 'adminl@test.com'), 'coleccionInventada', 'y'), { a: 1 }));
  });

  await testEnv.cleanup();
  console.log('\nListo. Revisa arriba si hubo alguna ❌.');
}
main();
