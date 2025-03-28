export const getDefaultLabels = () => {
    const [, az, paz] = process.env.KCS_DEPLOY_NAME?.split('-') ?? [];
    
    return {
        ksn: process.env.KWS_SERVICE_NAME ?? 'unknown',
        stage: process.env.KWS_SERVICE_STAGE ?? 'unknown',
        version: process.env.KWS_PRODUCT_VERSION ?? 'unknown',
        pod: process.env.MY_POD_NAME ?? 'unknown',
        host: process.env.KWS_HOST_NAME ?? 'unknown',
        az,
        paz
    };
}; 