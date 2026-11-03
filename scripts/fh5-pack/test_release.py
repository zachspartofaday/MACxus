"""Source-release consumer regression: no manifest, engine, Wine or account."""
import hashlib, importlib.util, json, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('release_build',HERE/'build.py')
build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)
sha=lambda data:hashlib.sha256(data).hexdigest()

class Consumer(unittest.TestCase):
    def test_archived_descriptor_verifies_payload_without_recursive_manifest_or_engine(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);recipe=root/'recipe';scripts=recipe/'scripts/fh5-pack';assets=recipe/'assets/fh5-preview';bundle=root/'build';payload=bundle/'payload'
            scripts.mkdir(parents=True);assets.mkdir(parents=True);payload.mkdir(parents=True)
            shutil.copyfile(HERE/'verify.py',scripts/'verify.py')
            source=b'fixture source lock';(assets/'source.lock.json').write_bytes(source)
            files={name:sha(name.encode()) for name in ['d3d12.dll','xgameruntime.dll','windows.web.dll','macxus-metal4-timestamps.dylib']}
            for name in files:(payload/name).write_text(name)
            receipt={'sourceLockSHA256':sha(source),'files':files,'sourceArchive':{'sha256':'archive hash must stay out'}}
            manifest={'schema':1,'id':'fh5-preview-v1','storeId':'9NNX1VVR3KNQ','version':'20261015','buildTag':'fixture','engineFiles':{'never-accessed':sha(b'engine')}}
            descriptor=build.verification_descriptor(manifest,receipt)
            self.assertNotIn('sourceArchive',descriptor)
            (assets/'verification.json').write_text(json.dumps(descriptor));(bundle/'build.json').write_text(json.dumps(receipt))
            command=[sys.executable,str(scripts/'verify.py'),str(bundle),'--check-inputs-only','--output',str(root/'evidence')]
            result=subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertFalse((assets/'manifest.json').exists())
            self.assertFalse(json.loads((root/'evidence/inputs.json').read_text())['engineVerified'])
            (payload/'d3d12.dll').write_text('tampered');command[-1]=str(root/'tamper-evidence')
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)
            self.assertTrue((HERE/'SDK.md').is_file());self.assertTrue((HERE/'prepare-sdk.py').is_file())

if __name__=='__main__':unittest.main()
