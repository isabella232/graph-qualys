import xmlParser from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';

import {
  DetectionHost,
  ListHostDetectionsResponse,
} from '../../provider/client/types/vmpc';
import { toArray } from '../../provider/client/util';
import { createHostFindingEntity } from './converters';

describe('createHostFindingEntity', () => {
  const detectionsXml = fs
    .readFileSync(
      path.join(
        __dirname,
        '..',
        '..',
        '..',
        'test',
        'fixtures',
        'detections.xml',
      ),
    )
    .toString('utf8');

  const detectionsList = xmlParser.parse(
    detectionsXml,
  ) as ListHostDetectionsResponse;

  test('properties transferred', () => {
    const detectionHosts: DetectionHost[] = toArray(
      detectionsList.HOST_LIST_VM_DETECTION_OUTPUT?.RESPONSE?.HOST_LIST?.HOST,
    );
    for (const detectionHost of detectionHosts) {
      for (const hostDetection of toArray(
        detectionHost.DETECTION_LIST?.DETECTION,
      )) {
        const hostTargets = ['abc', '123'];
        expect(
          createHostFindingEntity(
            'finding-key',
            detectionHost,
            hostDetection,
            hostTargets,
          ),
        ).toMatchGraphObjectSchema({
          _class: 'Finding',
        });
      }
    }
  });
});