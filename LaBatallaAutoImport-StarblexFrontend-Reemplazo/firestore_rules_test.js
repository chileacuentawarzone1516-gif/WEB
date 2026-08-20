// ============================================================
// Batería de pruebas de firestore.rules — 13 casos.
// Requiere: npm install -D @firebase/rules-unit-testing firebase
// Ejecutar:  firebase emulators:exec --only firestore "node tests/firestore.rules.test.js"
// ============================================================
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, serverTimestamp } = require('firebase/firestore');

let testEnv;

async function setup() {
  testEnv = await initializeTestEnvironment({
    projectId: 'la-batalla-rules-test',
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
}
async function seedWithoutRules(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });
}
async function run(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); }
  catch (e) { console.error(`❌ ${name}\n   ${e.message}`); process.exitCode = 1; }
}

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
    const db = testEnv.authenticatedContext('customer1').firestore();
    await assertSucceeds(setDoc(doc(db, 'users', 'customer1'), perfil('c1@test.com', 'Cliente Uno', 'customer', 'active')));
  });

  await run('Cliente intenta crearse como admin → denegado', async () => {
    const db = testEnv.authenticatedContext('customer2').firestore();
    await assertFails(setDoc(doc(db, 'users', 'customer2'), perfil('c2@test.com', 'Cliente Dos', 'admin', 'active')));
  });

  await run('Cliente intenta cambiar su role después → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'customer3'), perfil('c3@test.com', 'C3', 'customer', 'active')));
    const db = testEnv.authenticatedContext('customer3').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'customer3'), { role: 'admin' }));
  });

  await run('Admin cambia el role de otro usuario → permitido', async () => {
    await seedWithoutRules(async db => {
      await setDoc(doc(db, 'users', 'admin1'), perfil('a1@test.com', 'Admin', 'admin', 'active'));
      await setDoc(doc(db, 'users', 'customer4'), perfil('c4@test.com', 'C4', 'customer', 'active'));
    });
    const db = testEnv.authenticatedContext('admin1').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', 'customer4'), { role: 'editor' }));
  });

  await run('Usuario disabled intenta modificar vehículos → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'disabled1'), perfil('d1@test.com', 'D1', 'editor', 'disabled')));
    const db = testEnv.authenticatedContext('disabled1').firestore();
    await assertFails(setDoc(doc(db, 'vehicles', 'v1'), vehiculo('Toyota Corolla 2024', 'toyota-corolla-2024')));
  });

  await run('Cliente intenta crear vehículos → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'customer5'), perfil('c5@test.com', 'C5', 'customer', 'active')));
    const db = testEnv.authenticatedContext('customer5').firestore();
    await assertFails(setDoc(doc(db, 'vehicles', 'v2'), vehiculo('Honda Civic 2024', 'honda-civic-2024')));
  });

  await run('Editor crea/edita vehículos → permitido', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'editor1'), perfil('e1@test.com', 'E1', 'editor', 'active')));
    const db = testEnv.authenticatedContext('editor1').firestore();
    await assertSucceeds(setDoc(doc(db, 'vehicles', 'v3'), vehiculo('Kia Sportage 2025', 'kia-sportage-2025')));
  });

  await run('Sales intenta editar vehículos → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'sales1'), perfil('s1@test.com', 'S1', 'sales', 'active')));
    const db = testEnv.authenticatedContext('sales1').firestore();
    await assertFails(setDoc(doc(db, 'vehicles', 'v4'), vehiculo('Ford Ranger 2024', 'ford-ranger-2024')));
  });

  await run('Cliente intenta modificar su propio email → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'customer6'), perfil('c6@test.com', 'C6', 'customer', 'active')));
    const db = testEnv.authenticatedContext('customer6').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'customer6'), { email: 'nuevo@test.com' }));
  });

  await run('Correo en la whitelist se auto-promueve a admin → permitido', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'whitelisted1'), perfil('manuel15160410@gmail.com', 'Manuel', 'customer', 'active')));
    const db = testEnv.authenticatedContext('whitelisted1').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', 'whitelisted1'), { role: 'admin' }));
  });

  await run('Correo NO whitelisteado intenta auto-promoverse a admin → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'customer10'), perfil('atacante@test.com', 'Atacante', 'customer', 'active')));
    const db = testEnv.authenticatedContext('customer10').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'customer10'), { role: 'admin' }));
  });

  await run('Cliente intenta modificar schemaVersion → denegado', async () => {
    await seedWithoutRules(db => setDoc(doc(db, 'users', 'customer7'), perfil('c7@test.com', 'C7', 'customer', 'active')));
    const db = testEnv.authenticatedContext('customer7').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'customer7'), { schemaVersion: 2 }));
  });

  await run('Editor intenta modificar users → denegado', async () => {
    await seedWithoutRules(async db => {
      await setDoc(doc(db, 'users', 'editor2'), perfil('e2@test.com', 'E2', 'editor', 'active'));
      await setDoc(doc(db, 'users', 'customer8'), perfil('c8@test.com', 'C8', 'customer', 'active'));
    });
    const db = testEnv.authenticatedContext('editor2').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'customer8'), { role: 'admin' }));
  });

  await run('Admin intenta asignar role="pepito" → denegado', async () => {
    await seedWithoutRules(async db => {
      await setDoc(doc(db, 'users', 'admin2'), perfil('a2@test.com', 'Admin2', 'admin', 'active'));
      await setDoc(doc(db, 'users', 'customer9'), perfil('c9@test.com', 'C9', 'customer', 'active'));
    });
    const db = testEnv.authenticatedContext('admin2').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'customer9'), { role: 'pepito' }));
  });

  await run('Usuario sin documento en users intenta crear vehículos → denegado', async () => {
    const db = testEnv.authenticatedContext('ghost1').firestore();
    await assertFails(setDoc(doc(db, 'vehicles', 'v5'), vehiculo('Nissan Frontier 2024', 'nissan-frontier-2024')));
  });

  await testEnv.cleanup();
  console.log('\nListo. Revisa arriba si hubo alguna ❌.');
}
main();
