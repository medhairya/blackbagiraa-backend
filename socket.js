const socket = require('socket.io');

let io;

const initializeSocket = (server) => {
    io = socket(server,{
        cors:{
            origin:'*',
            methods:['GET','POST','PUT','DELETE'],
        }
    });
    io.on('connection',(socket)=>{
        console.log("socket id is",socket.id);
    });
    return io;
};

const getIo=()=>{
    if(!io){
        throw new Error("Socket not initialized");
    }
    return io;
}

module.exports = {initializeSocket,getIo};
