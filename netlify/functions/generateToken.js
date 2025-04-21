import { AccessToken } from "livekit-server-sdk";

export const handler = async (event) => {
  const { apiKey, apiSecret, roomName, identity } = JSON.parse(event.body);

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: 60 * 60,
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: false,
    canSubscribe: true,
  });

  const token = at.toJwt();

  return {
    statusCode: 200,
    body: JSON.stringify({ token }),
  };
};