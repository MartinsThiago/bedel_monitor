'use strict';

let docker = require('docker-remote-api'),
    os = require('os'),
    utils = require('./utils');

let api = docker({
    host: '/var/run/docker.sock'
});

function errorHandler(err, reject) {
    if (err && err.code == "EACCESS") {
        console.warn("monitor");
        return reject(err);
    }

    if (err && err.code == "ENOENT") {
        console.warn(`monitor_docker: could not connect to ${api.host}`);
        return reject(err);
    }

    if (err) {
        return reject(err);
    }
}

function getDockerVersion() {
    return new Promise(function (resolve, reject) {
        api.get("/version", {json: true}, function (err, info) {
            errorHandler(err, reject);
            resolve(info.Version);
        });
    });
}

function getDockerContainers() {
    return new Promise(function (resolve, reject) {
        api.get("/containers/json", {json: true}, function (err, info) {
            errorHandler(err, reject);

            let containers = [],
                hostname = utils.normalizeElasticText(os.hostname());

            for (let container of info) {
                containers.push({
                    hostname: hostname,
                    metrics_type: "docker",
                    id: container.Id,
                    name: container.Names[0],
                    image: container.Image,
                    container_full_name: utils.normalizeElasticText(`${hostname}${container.Names[0]}`),
                });
            }

            resolve(containers);
        });
    })
}

function fillContainerInfo(cont) {
    return new Promise(function (resolve, reject) {

        api.get(`/containers/${cont.id}/stats?stream=false`, {json: true}, function (err, stats) {
            errorHandler(err, reject);

            let memoryLimit = stats.memory_stats.limit;
            let memoryUsage = stats.memory_stats.usage;

            let cpuDelta = stats.cpu_stats.cpu_usage.total_usage -  stats.precpu_stats.cpu_usage.total_usage;
            let systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
            let cpuUsage = cpuDelta / systemDelta * 100;

            cont.stats = {
                cpu: {
                    usage_percentage: Math.round(cpuUsage)
                },
                memory: {
                    limit: utils.bytesToMB(memoryLimit),
                    used: utils.bytesToMB(memoryUsage),
                    swap: utils.bytesToMB(stats.memory_stats.stats.swap),
                    usage_percentage: Math.round(memoryUsage / memoryLimit * 100)
                }
            };
            resolve(cont);
        });
    })
}


exports.logInfo = function () {
    let dockerVersion = {};

    getDockerVersion()
        .then(vrsn => dockerVersion = vrsn)
        .then(getDockerContainers)
        .then(containers => {
            for (let container of containers) {
                fillContainerInfo(container)
                    .then(contMetrics => {
                        console.log(JSON.stringify(contMetrics));
                    })
            }
        });
};