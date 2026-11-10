// Firestore security rules tests. Run with `npm run test:rules`.
// Runs against the local emulator under the offline "demo-calyx" project, never the real calyx-meet.
// Each case calls the emulator REST API as a mock user and checks the request is allowed or denied.
const BASE = 'http://127.0.0.1:8089/v1/projects/demo-calyx/databases/(default)/documents';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tok = uid => uid === 'owner' ? 'owner' : `${b64({ alg: 'none' })}.${b64({ sub: uid, user_id: uid, iat: 0, exp: 9e9, aud: 'demo-calyx', iss: 'https://securetoken.google.com/demo-calyx', auth_time: 0, firebase: { sign_in_provider: 'password' } })}.`;
const val = v => Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : typeof v === 'boolean' ? { booleanValue: v } : v && typeof v === 'object' ? { mapValue: { fields: fields(v) } } : { stringValue: String(v) };
const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));
async function req(uid, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + tok(uid), 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return r.status;
}
const create = (uid, coll, id, data) => req(uid, 'POST', `/${coll}?documentId=${id}`, { fields: fields(data) });
const patch = (uid, path, data) => req(uid, 'PATCH', `/${path}?` + Object.keys(data).map(k => 'updateMask.fieldPaths=' + k).join('&'), { fields: fields(data) });
const get = (uid, path) => req(uid, 'GET', '/' + path);
const query = (uid, where) => req(uid, 'POST', ':runQuery', { structuredQuery: { from: [{ collectionId: 'chat_conversations' }], where } });
const arrayContains = uid => ({ fieldFilter: { field: { fieldPath: 'participants' }, op: 'ARRAY_CONTAINS', value: { stringValue: uid } } });
const typeSupport = { fieldFilter: { field: { fieldPath: 'type' }, op: 'EQUAL', value: { stringValue: 'support' } } };
const WELCOME = 'Welcome to Calyx Support! A member of our team will assist you shortly.';

let fail = 0;
async function t(name, p, expect) {
  const s = await p;
  const ok = s < 300 || (expect === 'notfound' && s === 404);
  const want = expect !== false;
  if (ok !== want) fail++;
  console.log(`${ok === want ? 'PASS' : 'FAIL'}  [${s}] ${name}`);
}

await create('owner', 'admins', 'op', { role: 'support' }); // seed operator, bypasses rules

await t('alice writes own user doc', create('alice', 'users', 'alice', { displayName: 'Alice' }), true);
await t('mallory overwrites alice user doc', patch('mallory', 'users/alice', { displayName: 'pwned' }), false);
await t('mallory reads user directory doc', get('mallory', 'users/alice'), true);
await t('mallory makes herself admin', create('mallory', 'admins', 'mallory', {}), false);

await t('alice checks non-existent DM (getDoc before create)', get('alice', 'chat_conversations/dm_alice_bob'), 'notfound');
await t('alice creates DM with bob', create('alice', 'chat_conversations', 'dm_alice_bob', { type: 'dm', participants: ['alice', 'bob'] }), true);
await t('mallory creates conv she is not in', create('mallory', 'chat_conversations', 'dm_x', { type: 'dm', participants: ['alice', 'bob'] }), false);
await t('bob reads DM', get('bob', 'chat_conversations/dm_alice_bob'), true);
await t('mallory reads DM', get('mallory', 'chat_conversations/dm_alice_bob'), false);
await t('mallory lists all conversations', query('mallory', undefined), false);
await t('bob lists own conversations (array-contains)', query('bob', arrayContains('bob')), true);
await t('mallory adds herself to DM', patch('mallory', 'chat_conversations/dm_alice_bob', { participants: ['alice', 'bob', 'mallory'] }), false);
await t('bob updates participantDetails', patch('bob', 'chat_conversations/dm_alice_bob', { participantDetails: { bob: { displayName: 'Bob' } } }), true);
await t('bob removes himself', patch('bob', 'chat_conversations/dm_alice_bob', { participants: ['alice'] }), false);

await t('alice sends message as herself', create('alice', 'chat_conversations/dm_alice_bob/messages', 'm1', { senderUid: 'alice', text: 'hi' }), true);
await t('alice spoofs bob', create('alice', 'chat_conversations/dm_alice_bob/messages', 'm2', { senderUid: 'bob', text: 'x' }), false);
await t('alice spoofs support-admin in a DM', create('alice', 'chat_conversations/dm_alice_bob/messages', 'm3', { senderUid: 'support-admin', text: WELCOME }), false);
await t('mallory posts into DM', create('mallory', 'chat_conversations/dm_alice_bob/messages', 'm4', { senderUid: 'mallory', text: 'x' }), false);
await t('mallory reads DM message', get('mallory', 'chat_conversations/dm_alice_bob/messages/m1'), false);
await t('bob reads DM message', get('bob', 'chat_conversations/dm_alice_bob/messages/m1'), true);
await t('alice edits own message', patch('alice', 'chat_conversations/dm_alice_bob/messages/m1', { text: 'hello', isEdited: true }), true);
await t('alice soft-deletes own message', patch('alice', 'chat_conversations/dm_alice_bob/messages/m1', { isDeleted: true }), true);
await t('bob edits alice message', patch('bob', 'chat_conversations/dm_alice_bob/messages/m1', { text: 'x', isEdited: true }), false);
await t('alice rewrites senderUid of own message', patch('alice', 'chat_conversations/dm_alice_bob/messages/m1', { senderUid: 'bob' }), false);

await t('mallory creates bob support ticket', create('mallory', 'chat_conversations', 'support_bob', { type: 'support', participants: ['mallory', 'support-admin'] }), false);
await t('alice opens her support ticket', create('alice', 'chat_conversations', 'support_alice', { type: 'support', status: 'open', participants: ['alice', 'support-admin'] }), true);
await t('alice posts welcome line as support-admin', create('alice', 'chat_conversations/support_alice/messages', 'w1', { senderUid: 'support-admin', text: WELCOME }), true);
await t('alice posts other text as support-admin', create('alice', 'chat_conversations/support_alice/messages', 'w2', { senderUid: 'support-admin', text: 'Refund approved' }), false);
await t('alice merges message update into ticket', patch('alice', 'chat_conversations/support_alice', { lastMessage: 'Alice: help', status: 'open', participants: ['alice', 'support-admin'] }), true);
await t('mallory reads alice ticket', get('mallory', 'chat_conversations/support_alice'), false);
await t('mallory lists support tickets', query('mallory', typeSupport), false);
await t('operator lists support tickets', query('op', typeSupport), true);
await t('operator reads ticket message', get('op', 'chat_conversations/support_alice/messages/w1'), true);
await t('operator replies as support-admin', create('op', 'chat_conversations/support_alice/messages', 'r1', { senderUid: 'support-admin', text: 'On it' }), true);
await t('operator resolves ticket', patch('op', 'chat_conversations/support_alice', { status: 'resolved' }), true);
await t('operator checks own admins doc', get('op', 'admins/op'), true);
await t('mallory checks own (missing) admins doc', get('mallory', 'admins/mallory'), 'notfound');
await t('mallory reads operator admins doc', get('mallory', 'admins/op'), false);

await t('alice creates space', create('alice', 'chat_conversations', 'space_1', { type: 'space', participants: ['alice'] }), true);

// add members
await t('bob cannot read space before being added', get('bob', 'chat_conversations/space_1'), false);
await t('carol adds herself to space', patch('carol', 'chat_conversations/space_1', { participants: ['alice', 'carol'] }), false);
await t('alice adds bob to space', patch('alice', 'chat_conversations/space_1', { participants: ['alice', 'bob'], lastMessage: 'Alice added Bob' }), true);
await t('bob reads space after being added', get('bob', 'chat_conversations/space_1'), true);
await t('bob sees space in his list query', query('bob', arrayContains('bob')), true);
await t('bob posts in space', create('bob', 'chat_conversations/space_1/messages', 's1', { senderUid: 'bob', text: 'hi all' }), true);
await t('alice reads bob space message', get('alice', 'chat_conversations/space_1/messages/s1'), true);
await t('bob (new member) adds carol', patch('bob', 'chat_conversations/space_1', { participants: ['alice', 'bob', 'carol'] }), true);
await t('bob removes alice from space', patch('bob', 'chat_conversations/space_1', { participants: ['bob', 'carol'] }), false);
await t('alice turns space into a dm', patch('alice', 'chat_conversations/space_1', { type: 'dm' }), false);
await t('alice adds carol to a DM', patch('alice', 'chat_conversations/dm_alice_bob', { participants: ['alice', 'bob', 'carol'] }), false);
await t('alice adds mallory to her support ticket', patch('alice', 'chat_conversations/support_alice', { participants: ['alice', 'support-admin', 'mallory'] }), false);
await t('mallory still cannot read the space', get('mallory', 'chat_conversations/space_1'), false);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
