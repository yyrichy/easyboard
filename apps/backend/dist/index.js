import { Server } from '@hocuspocus/server';
const server = new Server({
    port: 1234,
    onConnect: async (data) => {
        console.log(`Connected: ${data.documentName}`);
    },
});
server.listen().then(() => {
    console.log('Hocuspocus listening on port 1234');
});
