/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-var-requires */
const { get, post } = require('../http');
const { poll } = require('../polling');
const { Agent } = require('../agent/Agent');

const aliceWalletConfig = {
  walletId: 'e2e-alice',
  walletSeed: '00000000000000000000000000000Test01',
};

const bobWalletConfig = {
  walletId: 'e2e-bob',
  walletSeed: '00000000000000000000000000000Test02',
};

describe('agents with agency', () => {
  let aliceAgent;
  let bobAgent;

  test('make a connection between agents', async () => {
    const agencyUrl = `http://localhost:3000`;

    const aliceAgentSender = new HttpMessageSender(agencyUrl);
    const bobAgentSender = new HttpMessageSender(agencyUrl);

    aliceAgent = new Agent('Alice', aliceWalletConfig, aliceAgentSender);
    await aliceAgent.init();
    const aliceAgencyInvitationUrl = await get(`${agencyUrl}/invitation`);
    await aliceAgent.acceptInvitationUrl(aliceAgencyInvitationUrl);

    bobAgent = new Agent('Bob', bobWalletConfig, bobAgentSender);
    await bobAgent.init();
    const bobAgencyInvitationUrl = await get(`${agencyUrl}/invitation`);
    await bobAgent.acceptInvitationUrl(bobAgencyInvitationUrl);

    pollMessages(aliceAgent, agencyUrl);
    pollMessages(bobAgent, agencyUrl);

    const invitationUrl = await aliceAgent.createInvitationUrl();
    await bobAgent.acceptInvitationUrl(invitationUrl);

    // We need to decode invitation URL to get keys from invitation
    // It can be maybe better to get connection ID instead of invitationUrl from the previous step and work with that
    const invitation = decodeInvitationFromUrl(invitationUrl);
    const aliceKeyAtAliceBob = invitation.recipientKeys[0];

    const aliceConnectionAtAliceBob = await poll(
      () => aliceAgent.findConnectionByMyKey(aliceKeyAtAliceBob),
      connection => connection.state !== 4,
      200
    );
    console.log('aliceConnectionAtAliceBob\n', aliceConnectionAtAliceBob);

    const bobKeyAtBobAlice = aliceConnectionAtAliceBob.theirKey;
    const bobConnectionAtBobAlice = await poll(
      () => bobAgent.findConnectionByMyKey(bobKeyAtBobAlice),
      connection => connection.state !== 4,
      200
    );
    console.log('bobConnectionAtAliceBob\n', bobConnectionAtBobAlice);

    expect(aliceConnectionAtAliceBob.did).toBe(bobConnectionAtBobAlice.theirDid);
    expect(aliceConnectionAtAliceBob.verkey).toBe(bobConnectionAtBobAlice.theirKey);
    expect(bobConnectionAtBobAlice.did).toBe(aliceConnectionAtAliceBob.theirDid);
    expect(bobConnectionAtBobAlice.verkey).toBe(aliceConnectionAtAliceBob.theirKey);
  });

  test('send a message to connection', async () => {
    const aliceConnections = await aliceAgent.getConnections();
    console.log(aliceConnections);

    const bobConnections = await bobAgent.getConnections();
    console.log(bobConnections);

    // send message from Alice to Bob
    const message = 'hello, world';
    await aliceAgent.sendMessageToConnection(aliceConnections[0], message);

    const bobMessages = await poll(
      () => {
        console.log(`Getting Bob's connection messages...`);
        const connections = bobAgent.getConnections();
        return connections[0].messages;
      },
      messages => messages.length < 1
    );
    console.log(bobMessages);
    expect(bobMessages[0].content).toBe(message);
  });
});

function pollMessages(agent, agencyUrl) {
  poll(
    async () => {
      const message = await get(`${agencyUrl}/get-message/${verkey}`);
      agent.receiveMessage(message);
    },
    true,
    1000
  );
}

class HttpMessageSender {
  constructor(endpoint) {
    this.endpoint = endpoint;
  }

  async sendMessage(message) {
    console.log('Sending message...');
    console.log(message);
    const response = await post(`${this.endpoint}/msg`);
    console.log(`HTTP response status: ${response.status} - ${response.statusText}`);
  }
}
