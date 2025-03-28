import client, { PrometheusContentType } from 'prom-client';
import { AppResponse, IMetric, MetricType } from '../types';
import { getLogger } from '../utils/logger';
import { IHistogram } from './prom/histogram';
import { ISummary } from './prom/summary';
import { getDefaultLabels } from '../utils/labels';

type IAppPidMetric = Record<string, IMetric>;
type IAppNameMetric = Record<string, IAppPidMetric>;
const dynamicAppMetrics: { [key: string]: IAppNameMetric } = {};

const DEFAULT_LABELS = ['app', 'instance', 'ksn', 'stage', 'version', 'pod', 'host', 'az', 'paz'];

const parseLabels = (values: IMetric['values']) => {
    const labels = new Set<string>();

    values.forEach((entry) => {
        Object.keys(entry.labels).forEach((label) => {
            labels.add(String(label));
        });
    });

    return Array.from<string>(labels);
};

const createMetricByType = (metric: IMetric, labels: string[]) => {
    switch (metric.type) {
        case MetricType.Counter: {
            const metricEntry = new client.Counter({
                name: metric.name,
                help: metric.help,
                aggregator: metric.aggregator,
                labelNames: [...DEFAULT_LABELS, ...labels],
                registers: [],
            });

            return metricEntry;
        }
        case MetricType.Gauge: {
            const metricEntry = new client.Gauge({
                name: metric.name,
                help: metric.help,
                aggregator: metric.aggregator,
                labelNames: [...DEFAULT_LABELS, ...labels],
                registers: [],
            });

            return metricEntry;
        }
        case MetricType.Histogram: {
            const filteredMetrics = labels.filter((entry) => entry !== 'le');

            const metricEntry = new IHistogram({
                name: metric.name,
                help: metric.help,
                aggregator: metric.aggregator,
                labelNames: [...DEFAULT_LABELS, ...filteredMetrics],
                registers: [],
            });

            return metricEntry;
        }
        case MetricType.Summary: {
            const filteredMetrics = labels.filter((entry) => entry !== 'quantile');

            const metricEntry = new ISummary({
                name: metric.name,
                help: metric.help,
                aggregator: metric.aggregator,
                labelNames: [...DEFAULT_LABELS, ...filteredMetrics],
                registers: [],
            });

            return metricEntry;
        }
        default:
            return null;
    }
};

const createRegistryMetrics = (registry: client.Registry) => {
    const logger = getLogger();
    const metrics: Record<string, client.Metric> = {};

    for (const [appName, appEntry] of Object.entries(dynamicAppMetrics)) {
        for (const [metricName, pidEntry] of Object.entries(appEntry)) {
            for (const [pm2id, metric] of Object.entries(pidEntry)) {
                if (!metrics[metricName]) {
                    const parsedLabels = parseLabels(metric.values);
                    const newMetricStore = createMetricByType(metric, parsedLabels);

                    if (newMetricStore) {
                        metrics[metricName] = newMetricStore;
                    }
                }

                const createdMetric = metrics[metricName];

                if (!createdMetric) {
                    logger.error(`Unsupported metric type ${metric.type} for ${metricName}`);
                } else {
                    // Register metric
                    registry.registerMetric(createdMetric);

                    const defaultLabels: Record<string, string | number> = {
                        app: appName,
                        instance: pm2id,
                        ...getDefaultLabels()
                    };

                    // Fill data
                    switch (metric.type) {
                        case MetricType.Counter: {
                            metric.values.forEach((entry) => {
                                try {
                                    (createdMetric as client.Counter).inc(
                                        { ...entry.labels, ...defaultLabels },
                                        entry.value
                                    );
                                } catch (error) {
                                    logger.error(error);
                                }
                            });

                            break;
                        }
                        case MetricType.Gauge: {
                            metric.values.forEach((entry) => {
                                try {
                                    (createdMetric as client.Gauge).inc(
                                        { ...entry.labels, ...defaultLabels },
                                        entry.value
                                    );
                                } catch (error) {
                                    logger.error(error);
                                }
                            });

                            break;
                        }
                        case MetricType.Histogram: {
                            (createdMetric as IHistogram).setValues(defaultLabels, metric.values);
                            break;
                        }
                        case MetricType.Summary: {
                            (createdMetric as ISummary).setValues(defaultLabels, metric.values);
                            break;
                        }
                        default:
                            break;
                    }
                }
            }
        }
    }
};

const getAggregatedMetrics = () => {
    const metrics: IMetric[][] = [];

    for (const [appName, appEntry] of Object.entries(dynamicAppMetrics)) {
        for (const [_metricName, pidEntry] of Object.entries(appEntry)) {
            const pidMetrics: IMetric[] = [];

            for (const [_pm2id, metric] of Object.entries(pidEntry)) {
                const metricWithApp = { ...metric };

                metricWithApp.values = metricWithApp.values.map((entry) => {
                    entry.labels['app'] = appName;
                    return entry;
                });

                pidMetrics.push(metricWithApp);
            }

            metrics.push(pidMetrics);
        }
    }

    return client.AggregatorRegistry.aggregate<PrometheusContentType>(metrics);
};

export const deleteAppMetrics = (appName: string) => {
    const logger = getLogger();

    if (dynamicAppMetrics[appName]) {
        logger.debug(`Remove AppMetrics for app ${appName}`);
        delete dynamicAppMetrics[appName];
    }
};

export const processAppMetrics = (
    _config: IConfig,
    data: { pmId: number; appName: string; appResponse: AppResponse }
) => {
    if (!Array.isArray(data.appResponse.metrics)) {
        return;
    }

    data.appResponse.metrics.forEach((entry) => {
        if (Array.isArray(entry.values) && entry.values.length) {
            const metricName = entry.name;

            if (!dynamicAppMetrics[data.appName]) {
                dynamicAppMetrics[data.appName] = {};
            }

            const appKey = dynamicAppMetrics[data.appName][metricName];

            if (!appKey) {
                dynamicAppMetrics[data.appName][metricName] = {};
            }

            const pm2id = String(data.pmId);
            dynamicAppMetrics[data.appName][metricName][pm2id] = entry;
        }
    });
};

export const getAppRegistry = (needAggregate: boolean) => {
    if (Object.keys(dynamicAppMetrics).length) {
        if (needAggregate) {
            return getAggregatedMetrics();
        } else {
            const registry = new client.Registry();
            createRegistryMetrics(registry);
            return registry;
        }
    }

    return undefined;
};
