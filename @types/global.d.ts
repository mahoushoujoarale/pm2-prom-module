type IConfig = {
    debug: boolean;
    port: string;
    hostname: string;
    aggregate_app_metrics: boolean;
    app_check_interval: number;
    prefix: string;
};

type IPMXConfig = {
    module_conf: IConfig;
};

interface ErrnoException extends Error {
    errno?: number;
    code?: string;
    path?: string;
    syscall?: string;
    stack?: string;
}
