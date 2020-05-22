"""Example script for launching under WSGI"""
import atexit
import configparser
import os
import signal

import apitess
from tesserae.utils.coordinate import JobQueue


# Give app chance to clean up when signal is sent
def raise_exit(*args):
    raise SystemExit()


for sig in [signal.SIGHUP, signal.SIGINT, signal.SIGTERM]:
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

config = read_config()

db_config = config['MONGO']
db_cred = {
    'host': 'localhost',
    'port': int(db_config['port']),
    'user': db_config['user'],
    'password': db_config['password'],
    'db': db_config['db']
}

a_searcher = JobQueue(5, db_cred)

atexit.register(a_searcher.cleanup)

app_db_config = {
    'MONGO_HOSTNAME': db_cred['host'],
    'MONGO_PORT': int(db_cred['port']),
    'MONGO_USER': db_cred['user'],
    'MONGO_PASSWORD': db_cred['password'],
    'DB_NAME': db_cred['db']
}
app = apitess.create_app(a_searcher, app_db_config)

if __name__ == '__main__':
    app.run(port=4040)
