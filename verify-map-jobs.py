"""Service behavior without an HTTP server or game resources."""
import threading
import time
import unittest
from map_jobs import MapJobs, BusyError


def wait(service, job):
    deadline = time.monotonic()+5
    while time.monotonic() < deadline:
        value = service.status(job['id'])
        if value.get('done') or value.get('error'):
            return value
        time.sleep(.005)
    raise AssertionError('Job did not finish')


class JobChecks(unittest.TestCase):
    def test_serial_execution_and_busy_admission(self):
        entered, release = threading.Event(), threading.Event()
        calls = []
        def analyze(*args, **kwargs):
            calls.append(args[3])
            if len(calls) == 1:
                entered.set()
                if not release.wait(5):
                    raise RuntimeError('test release timeout')
            return {'metadata': {'cellCount': 1}}
        jobs = MapJobs(analyzer=analyze)
        first = jobs.submit(b'', 'yr', 'background', (), background=True)
        self.assertTrue(entered.wait(5))
        try:
            second = jobs.submit(b'', 'yr', 'foreground', ())
            snapshot = jobs.status(second['id'])
            self.assertIn('等待', snapshot['message'])
            snapshot['done'] = True
            self.assertFalse(jobs.status(second['id'])['done'], 'Poll responses must be copies')
            for background in (True, False):
                with self.assertRaises(BusyError):
                    jobs.submit(b'', 'yr', 'third', (), background=background)
            self.assertEqual(calls, ['background'])
        finally:
            release.set()
        self.assertTrue(wait(jobs, first)['done'])
        self.assertTrue(wait(jobs, second)['done'])
        self.assertEqual(calls, ['background', 'foreground'])

    def test_bounded_history_and_failure_recovery(self):
        def analyze(*args, **kwargs):
            if args[3] == 'fail':
                raise ValueError('bad map')
            return {'metadata': {'cellCount': 1}}
        jobs = MapJobs(history_limit=3, analyzer=analyze)
        failed = jobs.submit(b'', 'yr', 'fail', ())
        self.assertEqual(wait(jobs, failed)['error'], 'bad map')
        completed = []
        for index in range(7):
            job = jobs.submit(b'', 'yr', str(index), ())
            self.assertTrue(wait(jobs, job)['done'])
            completed.append(job)
        self.assertIsNone(jobs.status(failed['id']))
        self.assertEqual(sum(jobs.status(job['id']) is not None for job in completed), 3)


if __name__ == '__main__':
    unittest.main()
