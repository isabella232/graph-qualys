// Types manually created from review of
// https://www.qualys.com/docs/qualys-api-vmpc-user-guide.pdf. We don't have
// enough data in our trial account to express all permutations.

import { PossibleArray, ISODateString } from '../util';

// https://qualysapi.qg3.apps.qualys.com/api/2.0/fo/asset/host/vm/detection/host_list_vm_detection_output.dtd
export type ListHostDetectionsResponse = {
  HOST_LIST_VM_DETECTION_OUTPUT?: ListHostDetectionOutput;
};

export type ListHostDetectionOutput = {
  RESPONSE?: ListHostDetectionResponse;
};

export type ListHostDetectionResponse = {
  DATETIME?: ISODateString;
  HOST_LIST?: DetectionHostList;
  WARNING?: {
    URL?: string;
  };
};

export type DetectionHostList = {
  HOST?: PossibleArray<DetectionHost>;
};

export type DetectionHost = {
  ID?: number;
  IP?: string; // 10.97.5.247, ??
  TRACKING_METHOD?: string; // EC2, ??
  OS?: string;
  DNS?: string; // === EC2_INSTANCE_ID, ??
  EC2_INSTANCE_ID?: string;
  LAST_SCAN_DATETIME?: ISODateString;
  LAST_VM_SCANNED_DATE?: ISODateString;
  LAST_VM_SCANNED_DURATION?: number;
  DETECTION_LIST?: HostDetectionList;
  NETBIOS?: string;
  QG_HOSTID?: string;
  LAST_VM_AUTH_SCANNED_DATE?: ISODateString;
  LAST_PC_SCANNED_DATE?: ISODateString;
};

export type HostDetectionList = {
  DETECTION?: PossibleArray<HostDetection>;
};

export type HostDetection = {
  QID?: number;
  TYPE?: HostDetectionType;
  SEVERITY?: number;
  RESULTS?: string;
  FIRST_FOUND_DATETIME?: ISODateString;
  LAST_FOUND_DATETIME?: ISODateString;
  TIMES_FOUND?: number;
  IS_DISABLED?: number;
  LAST_PROCESSED_DATETIME?: ISODateString;
  PORT?: number;
  PROTOCOL?: HostDetectionProtocol;
  SSL?: number;
  STATUS?: HostDetectionStatus;
  LAST_TEST_DATETIME?: ISODateString;
  LAST_UPDATE_DATETIME?: ISODateString;
  IS_IGNORED?: number;
};

export type Metadata = {
  EC2: EC2Metadata;
};

export type MetadataAttribute = {
  /**
   * The attribute name. Examples:
   *
   * * latest/dynamic/instance-identity/document/region
   * * latest/dynamic/instance-identity/document/accountId
   */
  NAME: string;

  /**
   * The attribute value. Examples:
   *
   * * us-east-1
   * * 205767712438
   */
  VALUE: string;
  LAST_STATUS: string; // Success, Error??
  LAST_SUCCESS_DATE: string; // 2017-03-21T13:39:38Z
  LAST_ERROR_DATE: string; // 2017-03-21T13:39:38Z
  LAST_ERROR: string;
};

export type EC2Metadata = {
  ATTRIBUTE?: PossibleArray<MetadataAttribute>;
};

export type HostDetectionProtocol = 'tcp' | string;
export type HostDetectionStatus = 'Active' | 'New' | string;
export type HostDetectionType = 'Confirmed' | 'Info' | string;
