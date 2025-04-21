import { AccessToken } from 'livekit-server-sdk';

const roomName = 'test_room';
const participantName = 'subscriber_user';

const at = new AccessToken('APIxej8ee8wGah7', 'SwkeT6HGGTIZOozO51KEbHvKWW44LkpT1dl8w9ie8Hp', {
  identity: participantName,
});

const videoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: false,
    canSubscribe: true,
  };
  

at.addGrant(videoGrant);

const token = await at.toJwt();
console.log('access token', token);