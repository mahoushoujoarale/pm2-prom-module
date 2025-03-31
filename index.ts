// @ts-ignore
import pmx from 'pmx';
import { createServer, ServerResponse, IncomingMessage } from 'http';
import { startPm2Connect } from './core/pm2';
import { getLogger, initLogger } from './utils/logger';
import { initMetrics, combineAllRegistries } from './metrics';
import { getDefaultLabels } from './utils/labels';
import { Kess } from '@infra-node/kess';

const startPromServer = (moduleConfig: IConfig) => {
    initMetrics();

    const port = Number(moduleConfig.port);
    const hostname = moduleConfig.hostname;

    const logger = getLogger();

    const kess = new Kess();
    kess.register(process.env.KWS_SERVICE_NAME ?? 'unknown', port, { schema: 'http' })
      .then((res) => {
        if (res.code) {
          logger.info(`KESS 注册失败: ${res.description}`);
        } else {
          logger.info(`KESS 注册成功: ${res.description}`);
        }
      })

    const promServer = createServer(async (_req: IncomingMessage, res: ServerResponse) => {
        const mergedRegistry = combineAllRegistries(Boolean(moduleConfig.aggregate_app_metrics));
        mergedRegistry.setDefaultLabels({ 
            ...getDefaultLabels()
        });

        res.setHeader('Content-Type', mergedRegistry.contentType);
        res.end(await mergedRegistry.metrics());

        return;
    });

    const listenCallback = () => {
        const listenValue = promServer.address();
        let listenString = '';

        if (typeof listenValue === 'string') {
            listenString = listenValue;
        } else {
            listenString = `${listenValue?.address}:${listenValue?.port}`;
        }

        console.log(`Metrics server is available on ${listenString}`);
    };
    
    promServer.listen(port, hostname, listenCallback);
};

pmx.initModule(
    {
        widget: {
            el: {
                probes: true,
                actions: true,
            },

            block: {
                actions: false,
                issues: true,
                meta: true,
            },
        },
    },
    function (err: any, conf: IPMXConfig) {
        if (err) return console.error(err.stack || err);

        const moduleConfig = conf.module_conf;

        initLogger({ isDebug: moduleConfig.debug });
        startPm2Connect(moduleConfig);
        startPromServer(moduleConfig);

        pmx.configureModule({
            human_info: [
                ['Status', 'Module enabled'],
                ['Debug', moduleConfig.debug ? 'Enabled' : 'Disabled'],
                [
                    'Aggregate apps metrics',
                    moduleConfig.aggregate_app_metrics ? 'Enabled' : 'Disabled',
                ],
                ['Port', moduleConfig.port],
                ['Check interval', `${moduleConfig.app_check_interval} ms`],
            ],
        });
    }
);
