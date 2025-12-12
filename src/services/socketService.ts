import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';

class SocketService {
    private io: Server | null = null;
    private static instance: SocketService;

    private constructor() { }

    public static getInstance(): SocketService {
        if (!SocketService.instance) {
            SocketService.instance = new SocketService();
        }
        return SocketService.instance;
    }

    public initialize(httpServer: HttpServer, allowedOrigins: string[]): void {
        if (this.io) {
            console.warn('SocketService already initialized');
            return;
        }

        this.io = new Server(httpServer, {
            cors: {
                origin: allowedOrigins,
                methods: ['GET', 'POST'],
                credentials: true
            }
        });

        this.io.on('connection', (socket: Socket) => {
            console.log(`🔌 New client connected: ${socket.id}`);

            socket.on('join_admin', () => {
                socket.join('admin_room');
                console.log(`🔌 Client ${socket.id} joined admin_room`);
            });

            socket.on('disconnect', () => {
                console.log(`🔌 Client disconnected: ${socket.id}`);
            });
        });

        console.log('✅ SocketService initialized');
    }

    public getIO(): Server {
        if (!this.io) {
            throw new Error('SocketService not initialized. Call initialize() first.');
        }
        return this.io;
    }

    public emitToAdmin(event: string, data: any): void {
        if (!this.io) return;
        this.io.to('admin_room').emit(event, data);
    }
}

export const socketService = SocketService.getInstance();
