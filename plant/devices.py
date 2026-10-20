"""Single source of truth for the virtual plant: topology, devices, expected identity (ground truth).

Identity strings are real device families that have advisories in the ReConnICS-ng index, at firmware levels
that fall inside an affected range, so the advisory stage has something to hit.
Truth conventions follow ReConnICS-ng/eval (Modbus fw without leading V, CIP rev major.%03d, serial %08X).
"""
OUI = {"schneider": "00:80:f4", "rockwell": "00:00:bc", "siemens": "00:1b:1b", "dell": "00:14:22", "vmware": "00:0c:29"}

# bridge name -> (subnet prefix, description). The router ns owns .1 on each.
SEGMENTS = {
    "cell1": ("10.10.1", "Line 1 packaging cell (control network)"),
    "cell2": ("10.10.2", "Line 2 utilities cell (control network)"),
    "sup":   ("10.10.3", "Supervisory network: HMI, EWS, historian"),
}

# name, segment, host octet, oui, kind, params
DEVICES = [
    dict(name="plc-m221", seg="cell1", host=10, oui="schneider", kind="modbus",
         ident=dict(VendorName="Schneider Electric", ProductCode="TM221CE16R", MajorMinorRevision="V1.5.0.1",
                    VendorUrl="www.se.com", ProductName="Modicon M221", ModelName="TM221CE16R"),
         truth=dict(vendor="Schneider Electric", model="TM221CE16R", firmware="1.5.0.1", role="plc")),
    dict(name="plc-m340", seg="cell1", host=11, oui="schneider", kind="modbus",
         ident=dict(VendorName="Schneider Electric", ProductCode="BMXP342020", MajorMinorRevision="V2.10",
                    VendorUrl="www.se.com", ProductName="Modicon M340", ModelName="BMXP342020"),
         truth=dict(vendor="Schneider Electric", model="BMXP342020", firmware="2.10", role="plc")),
    # snap7's native server answers SZL 0x0011/0x001C with a fixed S7-300 CPU 315-2 PN/DP identity
    dict(name="plc-s7-315", seg="cell1", host=12, oui="siemens", kind="s7native",
         truth=dict(vendor="Siemens", model="6ES7 315-2EH14-0AB0", firmware="3.2.6", role="plc")),
    # cpppo ENIP: Product Revision word = major + 256*minor
    dict(name="plc-l33er", seg="cell2", host=10, oui="rockwell", kind="enip",
         cip=dict(vendor=1, devtype=14, pc=104, rev=(20, 11), serial=0x60E1F4A2, status=0x3160,
                  name="1769-L33ER/A LOGIX5333ER"),
         truth=dict(vendor="Rockwell Automation", model="1769-L33ER", firmware="20.011", serial="60E1F4A2", role="plc")),
    dict(name="drive-pf525", seg="cell2", host=11, oui="rockwell", kind="enip",
         cip=dict(vendor=1, devtype=2, pc=144, rev=(5, 1), serial=0xC07A2214, status=0x0064,
                  name="PowerFlex 525 1P 240V 2.2kW"),
         truth=dict(vendor="Rockwell Automation", model="PowerFlex 525", firmware="5.001", serial="C07A2214", role="drive")),
    dict(name="plc-m580", seg="cell2", host=12, oui="schneider", kind="modbus",
         ident=dict(VendorName="Schneider Electric", ProductCode="BMEP582040", MajorMinorRevision="V2.70",
                    VendorUrl="www.se.com", ProductName="Modicon M580", ModelName="BMEP582040"),
         truth=dict(vendor="Schneider Electric", model="BMEP582040", firmware="2.70", role="plc")),
    # clients: no identity of their own
    dict(name="hmi", seg="sup", host=20, oui="dell", kind="hmi", truth=dict(role="hmi")),
    dict(name="ews", seg="sup", host=21, oui="dell", kind="ews", truth=dict(role="ews")),
    dict(name="historian", seg="sup", host=22, oui="vmware", kind="historian", truth=dict(role="historian")),
]
