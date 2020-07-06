"""Example script for launching under WSGI"""
import atexit
import configparser
from multiprocessing import freeze_support
import os
import signal
import sys

import apitess
from tesserae.utils.coordinate import JobQueue
from tesserae.utils.ingest import IngestQueue


os.environ['HOME'] = os.path.expanduser('~/tesserae')
os.environ['ADMIN_INSTANCE'] = 'true'


# Give app chance to clean up when signal is sent
def raise_exit(*args):
    raise SystemExit()

kill_signals = [signal.SIGINT, signal.SIGTERM]
if sys.platform == 'win32':
    kill_signals.extend([signal.SIGBREAK])
else:
    kill_signals.extend([signal.SIGHUP])

for sig in kill_signals:
    signal.signal(sig, raise_exit)

def read_config():
    configpath = os.path.expanduser('~/tesserae.cfg')
    config = configparser.ConfigParser()
    if os.path.exists(configpath):
        print(f'[Configuration] Using user-provided database configuration ({configpath})')
        with open(configpath, 'r', encoding='utf-8') as ifh:
            config.read_file(ifh)
    default_db_config = {
        'port': '40404',
        'user': '',
        'password': '',
        'db': 'tesserae'
    }
    if 'MONGO' not in config:
        config['MONGO'] = {}
    db_config = config['MONGO']
    for k, v in default_db_config.items():
        if k not in db_config:
            print(f'[Configuration] Setting MongoDB {k} to default ({v})')
            db_config[k] = v
    return config

if __name__ == '__main__':
    freeze_support()
    config = read_config()

    db_config = config['MONGO']
    db_cred = {
        'host': 'localhost',
        'port': int(db_config['port']),
        'user': db_config['user'],
        'password': db_config['password'],
        'db': db_config['db']
    }

    app_db_config = {
        'MONGO_HOSTNAME': db_cred['host'],
        'MONGO_PORT': int(db_cred['port']),
        'MONGO_USER': db_cred['user'],
        'MONGO_PASSWORD': db_cred['password'],
        'DB_NAME': db_cred['db']
    }

    a_searcher = JobQueue(2, db_cred)
    atexit.register(a_searcher.cleanup)
    ingest_queue = IngestQueue(db_cred)
    atexit.register(ingest_queue.cleanup)
    app = apitess.create_app(a_searcher, ingest_queue.cleanup, app_db_config)
    app.run(port=4040)
