export interface IRedisService {
  /** Explicitly establish connection */
  connect(): Promise<void>;

  /** Push message to the right of a list (producer) */
  push(key: string, value: string): Promise<void>;

  /** Pop from left, block until message available (consumer) */
  bpop(key: string, timeoutSeconds?: number): Promise<string | null>;

  /** Non-blocking pop from left */
  pop(key: string): Promise<string | null>;

  /** Get queue length */
  len(key: string): Promise<number>;

  /** Delete a key */
  del(key: string): Promise<void>;

  /** Ping to check connection */
  ping(): Promise<boolean>;

  /** Close connection */
  quit(): Promise<void>;
}
